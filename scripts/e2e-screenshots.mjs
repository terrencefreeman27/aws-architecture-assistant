// Browser check + screenshots against a running local dev instance.
// Usage: start `npm run dev` (or API + web separately), then `npm run e2e`.
// Uses playwright-core with an already-installed Chromium (no download).
import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const BASE = process.env.E2E_URL ?? 'http://localhost:5180/';
const OUT = fileURLToPath(new URL('../docs/screenshots/', import.meta.url));
await mkdir(OUT, { recursive: true });

const failures = [];
const check = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) failures.push(msg);
};

const browser = await chromium.launch();
const consoleErrors = [];

async function newPage(width, height) {
  const ctx = await browser.newContext({ viewport: { width, height }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  page.on('pageerror', (e) => consoleErrors.push(e.message));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  return page;
}

const diagramReady = (page) => page.waitForSelector('[data-testid="diagram"] svg', { timeout: 20000 });
// Mermaid wraps long labels into separate lines without a space, so compare with whitespace removed.
const diagramText = (page) => page.evaluate(() => (document.querySelector('[data-testid="diagram"]')?.textContent ?? '').replace(/\s+/g, ''));
const waitForDiagramText = (page, re) =>
  page.waitForFunction((src) => new RegExp(src).test((document.querySelector('[data-testid="diagram"]')?.textContent ?? '').replace(/\s+/g, '')), re.source, { timeout: 20000 });
async function loadScenario(page, name, marker) {
  await page.getByRole('button', { name: new RegExp(name) }).click();
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

try {
  /* ---------------- Desktop 1440 ---------------- */
  const page = await newPage(1440, 900);
  check((await page.getByText('No plan yet').count()) === 1, 'empty state shown before any plan');
  await page.screenshot({ path: OUT + '01-empty-desktop-1440.png' });

  for (const [name, file, marker] of [
    ['Basic web application', '02-web-app-desktop-1440.png', /Users/],
    ['Integration between existing systems', '03-integration-desktop-1440.png', /Salesforce/],
    ['AI knowledge assistant', '04-ai-assistant-desktop-1440.png', /KnowledgeBase/],
  ]) {
    await loadScenario(page, name, marker);
    const nodes = await page.locator('[data-testid="diagram"] svg g.node').count();
    check(nodes > 3, `${name}: diagram rendered with ${nodes} nodes`);
    check((await page.getByRole('heading', { name: 'Assumptions' }).count()) === 1, `${name}: assumptions visible`);
    await page.getByRole('tab', { name: /Alternatives/ }).click();
    check((await page.locator('.alternative').count()) >= 1, `${name}: at least one alternative with tradeoffs`);
    await page.getByRole('tab', { name: 'Components' }).click();
    check(await noHorizontalOverflow(page), `${name}: no horizontal overflow at 1440`);
    await resetScroll(page);
    await page.screenshot({ path: OUT + file });
  }

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

  // SVG export
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-svg').click()]);
  const path = await download.path();
  const { readFile } = await import('node:fs/promises');
  const svgText = await readFile(path, 'utf8');
  check(svgText.startsWith('<?xml') && svgText.includes('<svg') && /ECSFargate/.test(svgText.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, '').replace(/\s+/g, '')), `SVG export downloaded (${download.suggestedFilename()}, ${svgText.length} bytes)`);
  check(!svgText.includes('<foreignObject'), 'exported SVG uses plain SVG text (no foreignObject)');
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

  /* ---------------- Narrow 390 ---------------- */
  const narrow = await newPage(390, 844);
  await loadScenario(narrow, 'AI knowledge assistant', /KnowledgeBase/);
  check(await noHorizontalOverflow(narrow), 'no horizontal page overflow at 390px');
  await narrow.evaluate(() => document.querySelector('.workspace-head')?.scrollIntoView({ block: 'start' }));
  await narrow.screenshot({ path: OUT + '09-ai-assistant-mobile-390.png' });
  await narrow.screenshot({ path: OUT + '10-ai-assistant-mobile-390-full.png', fullPage: true });

  /* ---------------- Tablet 1024 ---------------- */
  const mid = await newPage(1024, 800);
  await loadScenario(mid, 'Integration between existing systems', /Salesforce/);
  check(await noHorizontalOverflow(mid), 'no horizontal page overflow at 1024px');
  await resetScroll(mid);
  await mid.screenshot({ path: OUT + '11-integration-tablet-1024.png' });
} catch (err) {
  failures.push(String(err));
  console.error(err);
} finally {
  await browser.close();
}

check(consoleErrors.length === 0, `no console errors${consoleErrors.length ? `: ${consoleErrors.join(' | ')}` : ''}`);
console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nAll browser checks passed');
process.exit(failures.length ? 1 : 0);
