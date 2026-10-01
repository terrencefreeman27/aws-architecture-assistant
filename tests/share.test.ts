import { EMPTY_REQUIREMENTS } from '../shared/schema';
import { SCENARIOS } from '../shared/scenarios';
import {
  MAX_PAYLOAD_CHARS,
  buildShareUrl,
  decodeRequirements,
  encodeRequirements,
  readShareHash,
  toBase64Url,
} from '../shared/share';
import { req } from './helpers';

const b64json = (value: unknown) => `j${toBase64Url(new TextEncoder().encode(JSON.stringify(value)))}`;

async function deflated(text: string): Promise<string> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return `z${toBase64Url(new Uint8Array(await new Response(stream).arrayBuffer()))}`;
}

describe('share link encoding', () => {
  it.each(SCENARIOS.map((s) => [s.id, s.requirements] as const))('round-trips the %s sample', async (_id, requirements) => {
    const payload = await encodeRequirements(requirements);
    expect(payload).toMatch(/^z[A-Za-z0-9_-]+$/);
    expect(payload.length).toBeLessThan(1200);
    const decoded = await decodeRequirements(payload);
    expect(decoded).toEqual({ ok: true, requirements });
  });

  it('round-trips empty requirements and non-ASCII text', async () => {
    expect(await decodeRequirements(await encodeRequirements(EMPTY_REQUIREMENTS))).toEqual({ ok: true, requirements: EMPTY_REQUIREMENTS });
    const unicode = req({ description: 'Zürich portal — 東京 office, emoji 🚀, "quotes" & <tags>' });
    expect(await decodeRequirements(await encodeRequirements(unicode))).toEqual({ ok: true, requirements: unicode });
  });

  it('accepts the uncompressed "j" form', async () => {
    const r = SCENARIOS[0].requirements;
    expect(await decodeRequirements(b64json(r))).toEqual({ ok: true, requirements: r });
  });

  it('builds and reads a "#r=" fragment, replacing any existing fragment', async () => {
    const url = await buildShareUrl('https://example.test/app/#old', SCENARIOS[1].requirements);
    expect(url.startsWith('https://example.test/app/#r=z')).toBe(true);
    const payload = readShareHash(new URL(url).hash);
    expect(payload).not.toBeNull();
    expect(await decodeRequirements(payload!)).toEqual({ ok: true, requirements: SCENARIOS[1].requirements });
    expect(readShareHash('#something-else')).toBeNull();
    expect(readShareHash('')).toBeNull();
  });
});

describe('share link decoding rejects bad input safely', () => {
  it.each([
    ['empty', ''],
    ['unknown version tag', 'xAAAA'],
    ['non-base64url characters', 'z<script>alert(1)</script>'],
    ['impossible base64 length', 'zA'],
    ['corrupt deflate data', 'zAAECAwQFBgcICQ'],
    ['plain garbage text', 'jbm90IGpzb24'],
    ['JSON array', b64json(['web_app'])],
    ['JSON string', b64json('hello')],
    ['JSON null', b64json(null)],
  ])('%s', async (_name, payload) => {
    const res = await decodeRequirements(payload);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.length).toBeGreaterThan(10);
  });

  it('rejects a payload with one character flipped', async () => {
    const payload = await encodeRequirements(SCENARIOS[2].requirements);
    const i = Math.floor(payload.length / 2);
    const tampered = payload.slice(0, i) + (payload[i] === 'A' ? 'B' : 'A') + payload.slice(i + 1);
    const res = await decodeRequirements(tampered);
    // Either the stream is corrupt, or it decodes to something that must still pass the schema.
    if (res.ok) expect(res.requirements).not.toEqual(SCENARIOS[2].requirements);
    else expect(res.error).toBeTruthy();
  });

  it('rejects oversized payloads before decoding', async () => {
    const res = await decodeRequirements(`z${'A'.repeat(MAX_PAYLOAD_CHARS)}`);
    expect(res).toEqual({ ok: false, error: expect.stringMatching(/too long/) });
  });

  it('rejects a compression bomb that inflates past the size limit', async () => {
    const bomb = await deflated(JSON.stringify({ description: 'a'.repeat(200_000) }));
    expect(bomb.length).toBeLessThan(MAX_PAYLOAD_CHARS);
    expect((await decodeRequirements(bomb)).ok).toBe(false);
  });

  it.each([
    ['unknown enum value', { workloadType: 'mainframe' }],
    ['unknown region', { region: 'mars-north-1' }],
    ['wrong type', { description: 42 }],
    ['over-long text', { description: 'x'.repeat(2001) }],
    ['unknown key', { description: 'ok', isAdmin: true }],
    ['prototype pollution key', JSON.parse('{"__proto__": {"polluted": true}, "description": "x"}')],
  ])('rejects schema-invalid payloads: %s', async (_name, value) => {
    const res = await decodeRequirements(b64json(value));
    expect(res.ok).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('rejects schema-invalid payloads in the compressed form too', async () => {
    expect((await decodeRequirements(await deflated(JSON.stringify({ budget: 'unlimited' })))).ok).toBe(false);
  });
});
