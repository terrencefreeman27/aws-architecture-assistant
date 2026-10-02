// Browser check + screenshots against a running local instance.
// Usage: start `npm run dev` (or API + web separately), then `npm run e2e`.
// Static/production check: `npm run build`, serve dist/ with any static server
// (no /api), then `E2E_URL=http://localhost:PORT/ E2E_EXPECT_PLANNER=local npm run e2e`.
// Uses playwright-core with an already-installed Chromium (no download).
import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const BASE = process.env.E2E_URL ?? 'http://localhost:5180/';
// Optional: 'local' (in-browser demo planner, and no /api requests at all) or 'api'.
const EXPECT_PLANNER = process.env.E2E_EXPECT_PLANNER;
const OUT = fileURLToPath(new URL('../docs/screenshots/', import.meta.url));
await mkdir(OUT, { recursive: true });

const failures = [];
const check = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) failures.push(msg);
};

const browser = await chromium.launch();
const consoleErrors = [];
const apiRequests = [];

const offOrigin = [];

async function newPage(width, height, { url = BASE, initScript, clipboard = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, acceptDownloads: true });
  if (clipboard) await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(BASE).origin });
  const page = await ctx.newPage();
  if (initScript) await page.addInitScript(initScript);
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  page.on('pageerror', (e) => consoleErrors.push(e.message));
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith('/api')) apiRequests.push(r.url());
    // Everything is bundled: no request may leave the app's origin (data: and blob: URLs are local).
    if ((u.protocol === 'http:' || u.protocol === 'https:') && u.origin !== new URL(BASE).origin) offOrigin.push(r.url());
  });
  await page.goto(url, { waitUntil: 'networkidle' });
  return page;
}
const iconCount = (page) => page.locator('[data-testid="diagram"] svg g.icon-shape svg').count();
async function download(page, testId) {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId(testId).click()]);
  const { readFile } = await import('node:fs/promises');
  return { name: dl.suggestedFilename(), text: await readFile(await dl.path(), 'utf8') };
}

const diagramReady = (page) => page.waitForSelector('[data-testid="diagram"] svg', { timeout: 20000 });
// Mermaid wraps long labels into separate lines without a space, so compare with whitespace removed.
// <style> is excluded: it carries a per-render id, which differs between pages.
const diagramText = (page) =>
  page.evaluate(() => [...document.querySelectorAll('[data-testid="diagram"] svg text')].map((t) => t.textContent).join('').replace(/\s+/g, ''));
// Mermaid draws plain shapes as g.node and icon shapes as g.icon-shape.
const NODE_SEL = '[data-testid="diagram"] svg :is(g.node, g.icon-shape)';
const waitForDiagramText = (page, re) =>
  page.waitForFunction((src) => new RegExp(src).test((document.querySelector('[data-testid="diagram"]')?.textContent ?? '').replace(/\s+/g, '')), re.source, { timeout: 20000 });
async function loadScenario(page, name, marker) {
  await page.locator('.sidebar').getByRole('button', { name: new RegExp(name) }).click();
  await diagramReady(page);
  await waitForDiagramText(page, marker);
  await page.waitForTimeout(250);
}
const resetScroll = (page) =>
  page.evaluate(() => {
    for (const sel of ['.workspace', '.assistant', '.canvas']) document.querySelector(sel)?.scrollTo(0, 0);
    window.scrollTo(0, 0);
  });
const noHorizontalOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const activeInfo = (page) => page.evaluate(() => ({ id: document.activeElement?.id ?? '', tag: document.activeElement?.tagName ?? '', text: document.activeElement?.textContent?.trim() ?? '' }));
const mobileBarHidden = (page) => page.getByTestId('mobile-actions').evaluate((el) => getComputedStyle(el).display === 'none');

/** Share link round-trip, autosave restore, report, and SVG export at one viewport size. */
async function coreChecks(width, height) {
  const p = await newPage(width, height, { clipboard: true });
  await loadScenario(p, 'Integration between existing systems', /Salesforce/);
  const text = await diagramText(p);
  await p.getByTestId('copy-link').click();
  await p.getByRole('button', { name: 'Link copied' }).waitFor({ timeout: 5000 });
  const shared = await newPage(width, height, { url: await p.evaluate(() => navigator.clipboard.readText()) });
  await diagramReady(shared);
  await waitForDiagramText(shared, /Salesforce/);
  check((await diagramText(shared)) === text, `${width}px: share link reopens the same plan`);
  await shared.context().close();
  await p.reload({ waitUntil: 'networkidle' });
  await diagramReady(p);
  await waitForDiagramText(p, /Salesforce/);
  check((await diagramText(p)) === text, `${width}px: reload restores the autosave and the same plan`);
  const rep = await download(p, 'download-report');
  check(rep.text.includes('\n## Share link\n') && rep.text.includes('```mermaid'), `${width}px: report downloads with diagram and share link`);
  const svgOut = await download(p, 'export-svg');
  check((svgOut.text.match(/<svg\b/g) ?? []).length - 1 >= 5, `${width}px: exported SVG embeds the icons`);
  check(await noHorizontalOverflow(p), `${width}px: no horizontal overflow during core checks`);
  await p.context().close();
}

try {
  /* ---------------- Desktop 1440 ---------------- */
  const page = await newPage(1440, 900, { clipboard: true });
  check((await page.getByTestId('start-panel').count()) === 1, 'start panel shown before any plan');
  check((await page.locator('[data-testid^="start-sample-"]').count()) === 3, 'start panel offers the three samples');
  check(await mobileBarHidden(page), 'mobile action bar is hidden at 1440');
  const badge = await page.getByTestId('planner-mode').innerText({ timeout: 10000 });
  console.log(`      planner badge: "${badge}"`);
  if (EXPECT_PLANNER === 'local') check(badge === 'Demo planner (runs in your browser)', 'planner badge says the demo planner runs in the browser');
  if (EXPECT_PLANNER === 'api') check(badge.startsWith('Server API'), 'planner badge says the server API is used');
  await page.screenshot({ path: OUT + '01-empty-desktop-1440.png' });

  for (const [name, file, marker] of [
    ['Basic web application', '02-web-app-desktop-1440.png', /Users/],
    ['Integration between existing systems', '03-integration-desktop-1440.png', /Salesforce/],
    ['AI knowledge assistant', '04-ai-assistant-desktop-1440.png', /KnowledgeBase/],
  ]) {
    await loadScenario(page, name, marker);
    const nodes = await page.locator(NODE_SEL).count();
    check(nodes > 3, `${name}: diagram rendered with ${nodes} nodes`);
    const icons = await iconCount(page);
    check(icons >= 5, `${name}: ${icons} AWS service icons drawn in the diagram`);
    check((await page.getByRole('heading', { name: 'Assumptions' }).count()) === 1, `${name}: assumptions visible`);
    await page.getByRole('tab', { name: /Alternatives/ }).click();
    check((await page.locator('.alternative').count()) >= 1, `${name}: at least one alternative with tradeoffs`);
    await page.getByRole('tab', { name: 'Components' }).click();
    check(await noHorizontalOverflow(page), `${name}: no horizontal overflow at 1440`);
    await resetScroll(page);
    await page.screenshot({ path: OUT + file });
  }

  // Summary bar: counts match the plan and each item jumps to its tab or section with focus
  const summaryText = await page.getByTestId('plan-summary').innerText();
  const headerAws = Number(((await page.getByText(/AWS components from the supported catalog/).first().innerText()).match(/(\d+) AWS components/) || [])[1]);
  check(new RegExp(`${headerAws}\\s+AWS components`).test(summaryText), `summary bar counts ${headerAws} AWS components (matches the header)`);
  const assumptionCount = await page.locator('ul.assumptions > li').count();
  check(new RegExp(`${assumptionCount}\\s+assumptions?`).test(summaryText), `summary bar counts ${assumptionCount} assumptions (matches the panel)`);
  await page.getByTestId('summary-alternatives').click();
  await page.waitForTimeout(100);
  check((await page.getByRole('tab', { name: /Alternatives/ }).getAttribute('aria-selected')) === 'true' && (await activeInfo(page)).id === 'plan-tab-alternatives', 'summary "alternatives" opens the Alternatives tab and focuses it');
  await page.keyboard.press('ArrowRight');
  check((await page.getByRole('tab', { name: 'Implementation' }).getAttribute('aria-selected')) === 'true', 'arrow keys move between plan tabs');
  await page.getByTestId('summary-assumptions').focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(100);
  check((await activeInfo(page)).text === 'Assumptions', 'summary "assumptions" (keyboard) moves focus to the Assumptions section');
  await page.getByTestId('summary-open-questions').click();
  await page.waitForTimeout(100);
  check((await activeInfo(page)).text === 'Open questions', 'summary "open questions" moves focus to the Open questions section');
  await page.getByTestId('summary-components').click();
  await page.waitForTimeout(100);
  check((await activeInfo(page)).id === 'plan-tab-components', 'summary "components" opens the Components tab');
  await resetScroll(page);

  // Considerations tab with source chips and assumption labels
  await page.getByRole('tab', { name: 'Considerations' }).click();
  const chipHrefs = await page.locator('.pillar a.chip').evaluateAll((as) => as.map((a) => a.href));
  check(chipHrefs.length > 0 && chipHrefs.every((h) => h.startsWith('https://docs.aws.amazon.com/')), `considerations cite ${chipHrefs.length} official AWS links`);
  check((await page.locator('.badge-assumption').count()) > 0, 'unsupported claims are labelled as assumptions');
  await page.screenshot({ path: OUT + '05-considerations-desktop-1440.png' });

  // Edit a requirement and regenerate: web app on serverless -> containers + high availability
  await loadScenario(page, 'Basic web application', /DynamoDB/);
  const before = await diagramText(page);
  check(/APIGateway/.test(before) && /DynamoDB/.test(before), 'web app starts as serverless (API Gateway + DynamoDB)');
  await page.selectOption('#field-operations', 'containers');
  await page.selectOption('#field-availability', 'high');
  await page.waitForSelector('.callout.is-stale');
  check(true, 'stale-plan notice shown after editing requirements');
  await resetScroll(page);
  await page.screenshot({ path: OUT + '06-edited-requirements-stale-1440.png' });
  await page.getByRole('button', { name: 'Regenerate' }).click();
  await waitForDiagramText(page, /ECSFargate/);
  const after = await diagramText(page);
  check(/ECSFargate/.test(after) && /ApplicationLoadBalancer/.test(after) && /RDSdatabase/.test(after) && !/DynamoDBtables/.test(after), 'regenerated plan switched to containers (ALB + ECS + RDS)');
  check((await page.locator('.callout.is-stale').count()) === 0, 'stale notice cleared after regenerate');
  await resetScroll(page);
  await page.screenshot({ path: OUT + '07-regenerated-plan-1440.png' });

  // Copy link -> open in a fresh context -> same plan
  await page.getByTestId('copy-link').click();
  await page.getByRole('button', { name: 'Link copied' }).waitFor({ timeout: 5000 });
  const link = await page.evaluate(() => navigator.clipboard.readText());
  check(link.startsWith(BASE.split('#')[0]) && /#r=z[A-Za-z0-9_-]+$/.test(link), `copy link puts a #r= share link on the clipboard (${link.length} chars)`);
  const shared = await newPage(1440, 900, { url: link });
  await diagramReady(shared);
  await waitForDiagramText(shared, /ECSFargate/);
  check((await diagramText(shared)) === after, 'shared link opens the same plan in a fresh browser context');
  check((await shared.inputValue('#field-operations')) === 'containers' && (await shared.inputValue('#field-availability')) === 'high', 'shared link restores the edited requirements');
  check(!(await shared.evaluate(() => location.hash)), 'share fragment is cleared from the address bar after loading');
  await shared.context().close();

  // Reload restores the autosave and regenerates
  await page.reload({ waitUntil: 'networkidle' });
  await diagramReady(page);
  await waitForDiagramText(page, /ECSFargate/);
  check((await page.inputValue('#field-operations')) === 'containers' && (await diagramText(page)) === after, 'reload restores autosaved requirements and the same plan');

  // Markdown report
  const report = await download(page, 'download-report');
  const sections = ['## Summary', '## Requirements as entered', '## Architecture diagram', '## Components', '## Data flow', '## Assumptions', '## Open questions', '## Considerations by pillar', '## Alternatives and tradeoffs', '## Implementation sequence', '## Cautions', '## Sources', '## Share link'];
  const missing = sections.filter((h) => !report.text.includes(`\n${h}\n`));
  check(report.name.endsWith('-design.md') && missing.length === 0, `report downloaded (${report.name}, ${report.text.length} chars) with all sections${missing.length ? `; missing ${missing.join(', ')}` : ''}`);
  const mermaidSource = await page.evaluate(async () => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Mermaid source');
    btn?.click();
    await new Promise((r) => setTimeout(r, 50));
    const text = document.querySelector('.mermaid-source')?.textContent ?? '';
    btn?.click();
    return text;
  });
  check(report.text.includes('```mermaid\n' + mermaidSource + '\n```'), 'report embeds the same generated Mermaid as the Mermaid source panel');
  check(/\*\*Not production-ready\.\*\*/.test(report.text) && !/\$\s?\d/.test(report.text), 'report has the not-production-ready notice and no dollar figures');
  const reportUrls = report.text.match(/https?:\/\/[^\s)<>]+/g) ?? [];
  check(reportUrls.every((u) => u.startsWith('https://docs.aws.amazon.com/') || u.startsWith(BASE.split('#')[0] + '#r=')), `report links only to AWS docs sources and the share link (${reportUrls.length} URLs)`);
  await writeFile(fileURLToPath(new URL('../docs/example-report.md', import.meta.url)), report.text);

  // SVG export with embedded icons
  const svgFile = await download(page, 'export-svg');
  const svgText = svgFile.text;
  check(svgText.startsWith('<?xml') && svgText.includes('<svg') && /ECSFargate/.test(svgText.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, '').replace(/\s+/g, '')), `SVG export downloaded (${svgFile.name}, ${svgText.length} bytes)`);
  check(!svgText.includes('<foreignObject'), 'exported SVG uses plain SVG text (no foreignObject)');
  const nestedSvgs = (svgText.match(/<svg\b/g) ?? []).length - 1;
  check(nestedSvgs >= 5 && !/<image\b|xlink:href=|\shref="(?!#)/.test(svgText), `exported SVG embeds ${nestedSvgs} icons inline, with no external references`);
  await writeFile(fileURLToPath(new URL('../docs/example-architecture.svg', import.meta.url)), svgText);

  // Incomplete requirements -> follow-up questions, no plan
  await page.getByRole('button', { name: 'Clear' }).click();
  await page.fill('#field-description', 'An app for our team');
  await page.getByRole('button', { name: 'Generate plan' }).click();
  await page.waitForSelector('ol.questions li');
  const qCount = await page.locator('ol.questions li').count();
  check(qCount >= 5, `incomplete requirements produce ${qCount} follow-up questions`);
  check((await page.locator('[data-testid="diagram"]').count()) === 0, 'no diagram is produced for incomplete requirements');
  await page.waitForTimeout(400); // let the completeness meter finish its transition
  await page.screenshot({ path: OUT + '08-follow-up-questions-1440.png' });

  // Guardrails: cost + compliance phrasing produces cautions
  await loadScenario(page, 'Basic web application', /DynamoDB/);
  await page.fill('#field-description', 'A HIPAA compliant patient portal. How much will it cost per month? It must be production-ready.');
  await page.getByRole('button', { name: 'Regenerate' }).click();
  await page.waitForSelector('.cautions li');
  const cautionText = await page.locator('.cautions').innerText();
  check(/Exact cost/.test(cautionText) && /Compliance/.test(cautionText) && /Production readiness/.test(cautionText), 'cost, compliance, and production-readiness questions are flagged, not answered');
  check(!/\$\s?\d/.test(await page.locator('main').innerText()), 'no dollar figures anywhere in the plan');
  await page.getByTestId('summary-cautions').click();
  await page.waitForTimeout(100);
  check((await activeInfo(page)).text === 'Not answered with confidence', 'summary "cautions" moves focus to the cautions section');

  /* ---------------- Share link edge cases ---------------- */
  const bad = await newPage(1440, 900, { url: `${BASE.split('#')[0]}#r=zNotAValidPayload` });
  await bad.getByTestId('link-notice').waitFor({ timeout: 5000 });
  check(/damaged or was edited/.test(await bad.getByTestId('link-notice').innerText()), 'a tampered link shows a clear message instead of crashing');
  check((await bad.getByTestId('start-panel').count()) === 1, 'a tampered link falls back to the empty form and start panel');
  await bad.context().close();

  // Clipboard API unavailable -> selectable link field
  const noClip = await newPage(1440, 900, { initScript: () => Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true }) });
  await loadScenario(noClip, 'Basic web application', /DynamoDB/);
  await noClip.getByTestId('copy-link').click();
  await noClip.getByTestId('share-fallback').waitFor({ timeout: 5000 });
  const fieldValue = await noClip.inputValue('#share-link-field');
  check(/#r=z[A-Za-z0-9_-]+$/.test(fieldValue), 'without the Clipboard API the link is shown in a selectable field');
  check(await noHorizontalOverflow(noClip), 'share fallback field causes no horizontal overflow');
  await resetScroll(noClip);
  await noClip.screenshot({ path: OUT + '12-share-link-fallback-1440.png' });
  await noClip.context().close();

  // localStorage blocked -> app still works
  const noStore = await newPage(1440, 900, {
    initScript: () => Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('blocked', 'SecurityError'); } }),
  });
  await loadScenario(noStore, 'AI knowledge assistant', /KnowledgeBase/);
  check((await noStore.locator(NODE_SEL).count()) > 3, 'app works when localStorage is blocked');
  await noStore.context().close();

  /* ---------------- Start panel samples generate immediately ---------------- */
  const start = await newPage(1440, 900);
  await start.getByTestId('start-sample-integration').click();
  await diagramReady(start);
  await waitForDiagramText(start, /Salesforce/);
  check((await start.locator(NODE_SEL).count()) > 3 && (await start.inputValue('#field-workloadType')) === 'integration', 'start-panel sample fills the form and generates the plan with no extra click');
  await start.context().close();

  /* ---------------- "Not sure" answers ---------------- */
  const unsure = await newPage(1440, 900, { clipboard: true });
  await unsure.fill('#field-description', 'An online booking page where our salon customers pick a time slot and pay a deposit.');
  await unsure.selectOption('#field-workloadType', 'web_app');
  const UNSURE_FIELDS = ['expectedUsage', 'dataSensitivity', 'region', 'availability', 'budget', 'operations'];
  for (const f of UNSURE_FIELDS) await unsure.selectOption(`#field-${f}`, 'unsure');
  check((await unsure.locator('[data-testid^="assumed-"]').count()) === 6, 'each "Not sure" answer shows the default it will use');
  check(/8 of 8 required/.test(await unsure.locator('.completeness-count').innerText()), '"Not sure" counts as answered');
  await unsure.getByRole('button', { name: 'Generate plan' }).click();
  await diagramReady(unsure);
  const unsureItems = unsure.locator('ul.assumptions > li', { hasText: "You weren't sure" });
  check((await unsureItems.count()) === 6, `"Not sure" plan lists ${await unsureItems.count()} "You weren't sure" assumptions`);
  check((await unsureItems.locator('button', { hasText: /^Edit: / }).count()) === 6, 'each "Not sure" assumption has an Edit link');
  const unsureDiagram = await diagramText(unsure);
  check(/Cognito/.test(unsureDiagram) && /KMS/.test(unsureDiagram) && /CloudTrail/.test(unsureDiagram), 'unsure data sensitivity is treated as confidential (sign-in, KMS, CloudTrail in the diagram)');
  check((await unsure.locator('#plan-heading').innerText()).includes('us-east-1'), 'unsure location defaults to us-east-1');
  await resetScroll(unsure);
  await unsure.screenshot({ path: OUT + '13-not-sure-defaults-1440.png' });
  const unsureReport = await download(unsure, 'download-report');
  check(/Not sure, so assumed: Confidential/.test(unsureReport.text) && /You weren't sure how sensitive/.test(unsureReport.text), 'report shows what "Not sure" assumed');
  await unsureItems.filter({ hasText: 'how sensitive' }).getByRole('button').click();
  await unsure.waitForTimeout(200);
  check((await activeInfo(unsure)).id === 'field-dataSensitivity', '"Edit: Data sensitivity" focuses the field');
  await unsure.getByTestId('copy-link').click();
  await unsure.getByRole('button', { name: 'Link copied' }).waitFor({ timeout: 5000 });
  const unsureLink = await unsure.evaluate(() => navigator.clipboard.readText());
  const unsureShared = await newPage(1440, 900, { url: unsureLink });
  await diagramReady(unsureShared);
  await unsureShared.locator('ul.assumptions > li', { hasText: "You weren't sure" }).first().waitFor({ timeout: 10000 });
  check((await unsureShared.inputValue('#field-budget')) === 'unsure' && (await diagramText(unsureShared)) === unsureDiagram, 'a share link with "Not sure" answers reopens the same plan');
  await unsureShared.context().close();
  await unsure.context().close();

  /* ---------------- Narrow 390 ---------------- */
  const narrow = await newPage(390, 844);
  check((await narrow.getByTestId('start-panel').count()) === 1, 'start panel present at 390px');
  await narrow.screenshot({ path: OUT + '14-empty-mobile-390.png' });
  const bar = async () =>
    narrow.getByTestId('mobile-actions').evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { position: getComputedStyle(el).position, bottomGap: Math.round(window.innerHeight - r.bottom), visible: r.height > 0 };
    });
  let b = await bar();
  check(b.position === 'fixed' && b.visible && b.bottomGap === 0, 'Generate action is pinned to the bottom of the screen at 390px');
  check((await narrow.getByTestId('mobile-generate').innerText()) === 'Generate plan', 'pinned action reads "Generate plan" before a plan exists');
  await loadScenario(narrow, 'AI knowledge assistant', /KnowledgeBase/);
  await narrow.waitForTimeout(900); // let the reveal scroll settle
  check((await narrow.getByTestId('requirements-summary').isVisible()) && !(await narrow.locator('#requirements-body').isVisible()), 'after generating, requirements collapse into a summary');
  const headTop = await narrow.locator('#plan-heading').evaluate((el) => el.getBoundingClientRect().top);
  check(headTop >= -1 && headTop < 120, `after generating, the page scrolls to the plan (heading at ${Math.round(headTop)}px)`);
  check((await activeInfo(narrow)).id === 'plan-heading', 'focus moves to the plan heading');
  const diag = await narrow.locator('[data-testid="diagram"]').evaluate((el) => ({ svg: el.querySelector('svg').getBoundingClientRect().width, client: el.clientWidth, scroll: el.scrollWidth }));
  check(diag.svg > diag.client && diag.scroll > diag.client, `diagram starts at a readable size and scrolls sideways (${Math.round(diag.svg)}px wide in a ${diag.client}px frame)`);
  check(await narrow.getByTestId('diagram-scroll-hint').isVisible(), 'sideways-scroll hint shown');
  check(await noHorizontalOverflow(narrow), 'no horizontal page overflow at 390px');
  check((await iconCount(narrow)) >= 5, 'icons drawn at 390px');
  b = await bar();
  check(b.position === 'fixed' && b.bottomGap === 0 && (await narrow.getByTestId('mobile-generate').innerText()) === 'Regenerate', 'pinned action stays at the bottom and reads "Regenerate"');
  await narrow.screenshot({ path: OUT + '09-ai-assistant-mobile-390.png' });
  await narrow.screenshot({ path: OUT + '10-ai-assistant-mobile-390-full.png', fullPage: true });
  await narrow.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  b = await bar();
  const lastBlock = await narrow.locator('.assistant > :last-child').evaluate((el) => el.getBoundingClientRect().bottom);
  const barTop = await narrow.getByTestId('mobile-actions').evaluate((el) => el.getBoundingClientRect().top);
  check(b.bottomGap === 0 && lastBlock <= barTop + 1, 'at the end of the page the pinned bar does not cover content');
  // Edit requirements -> form opens; change something; regenerate from the pinned bar -> collapses again
  await narrow.getByTestId('edit-requirements').click();
  await narrow.waitForTimeout(300);
  check(await narrow.locator('#requirements-body').isVisible(), '"Edit requirements" re-opens the form');
  await narrow.selectOption('#field-dataSensitivity', 'unsure');
  await narrow.getByTestId('mobile-generate').click();
  await narrow.locator('ul.assumptions > li', { hasText: "You weren't sure how sensitive" }).waitFor({ timeout: 10000 });
  await narrow.waitForTimeout(900);
  check(!(await narrow.locator('#requirements-body').isVisible()), 'regenerating from the pinned bar collapses the form again');
  // An Edit link in the Assistant panel re-opens the form and focuses the field
  await narrow.locator('ul.assumptions button', { hasText: 'Edit: Data sensitivity' }).click();
  await narrow.waitForTimeout(400);
  check((await narrow.locator('#requirements-body').isVisible()) && (await activeInfo(narrow)).id === 'field-dataSensitivity', 'an Edit link re-opens the collapsed form and focuses the field');
  check(await noHorizontalOverflow(narrow), 'no horizontal page overflow at 390px after editing');
  await narrow.context().close();

  /* ---------------- Tablet 1024 ---------------- */
  const mid = await newPage(1024, 800);
  await loadScenario(mid, 'Integration between existing systems', /Salesforce/);
  check(await noHorizontalOverflow(mid), 'no horizontal page overflow at 1024px');
  check(await mobileBarHidden(mid), 'mobile action bar is hidden at 1024');
  check((await mid.getByTestId('plan-summary').count()) === 1, 'summary bar shown at 1024');
  await resetScroll(mid);
  await mid.screenshot({ path: OUT + '11-integration-tablet-1024.png' });
  await mid.context().close();

  await coreChecks(1024, 800);
  await coreChecks(390, 844);
} catch (err) {
  failures.push(String(err));
  console.error(err);
} finally {
  await browser.close();
}

check(offOrigin.length === 0, `no requests outside the app origin${offOrigin.length ? `: ${offOrigin.join(', ')}` : ''}`);
if (EXPECT_PLANNER === 'local') check(apiRequests.length === 0, `no /api requests in local mode${apiRequests.length ? `: ${apiRequests.join(', ')}` : ''}`);
check(consoleErrors.length === 0, `no console errors${consoleErrors.length ? `: ${consoleErrors.join(' | ')}` : ''}`);
console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nAll browser checks passed');
process.exit(failures.length ? 1 : 0);
