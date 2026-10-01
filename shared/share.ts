import { RequirementsSchema, type Requirements } from './schema';

/**
 * Share links carry the requirements in the URL fragment (`#r=<payload>`).
 * Fragments are never sent to a server, so a shared link does not leak the
 * requirements to any host, including the one serving this app.
 *
 * Payload format: a one-character version tag followed by base64url data.
 * - "z": JSON, compressed with deflate-raw (CompressionStream, built into browsers and Node).
 * - "j": plain JSON, used when CompressionStream is unavailable.
 * Only non-empty fields are included. Decoding is strict: anything that is
 * not a valid, size-limited requirements object is rejected with a reason.
 */

export const SHARE_PARAM = 'r';
/** Longest payload accepted from a link (characters after "#r="). */
export const MAX_PAYLOAD_CHARS = 12_000;
/** Largest decoded JSON accepted (bytes). Guards against compression bombs. */
export const MAX_JSON_BYTES = 16_000;

/** Unknown keys are rejected rather than silently dropped: a tampered link should fail loudly. */
const StrictRequirementsSchema = RequirementsSchema.strict();

export type DecodeResult = { ok: true; requirements: Requirements } | { ok: false; error: string };

/* ---------------- base64url ---------------- */

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return null;
  try {
    const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4));
    return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  } catch {
    return null;
  }
}

/* ---------------- deflate-raw via CompressionStream ---------------- */

const canCompress = () => typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Inflates, stopping as soon as the output exceeds `limit` bytes. Returns null on corrupt or oversized data. */
async function inflate(bytes: Uint8Array, limit: number): Promise<Uint8Array | null> {
  const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/* ---------------- encode / decode ---------------- */

function compact(req: Requirements): Partial<Requirements> {
  return Object.fromEntries(Object.entries(req).filter(([, v]) => v !== '')) as Partial<Requirements>;
}

/** Encodes requirements into a URL-safe payload (without the "#r=" prefix). */
export async function encodeRequirements(req: Requirements): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(compact(RequirementsSchema.parse(req))));
  if (canCompress()) return `z${toBase64Url(await deflate(json))}`;
  return `j${toBase64Url(json)}`;
}

const INVALID = 'The link is damaged or was edited, so its requirements could not be read.';

/** Decodes and validates a payload. Never throws. */
export async function decodeRequirements(payload: string): Promise<DecodeResult> {
  if (typeof payload !== 'string' || payload.length === 0) return { ok: false, error: 'The link has no requirements in it.' };
  if (payload.length > MAX_PAYLOAD_CHARS) return { ok: false, error: 'The link is too long to be a valid share link.' };

  const tag = payload[0];
  const bytes = fromBase64Url(payload.slice(1));
  if (!bytes || (tag !== 'z' && tag !== 'j')) return { ok: false, error: INVALID };

  let json: Uint8Array | null = bytes;
  if (tag === 'z') {
    if (!canCompress()) return { ok: false, error: 'This browser cannot open compressed share links.' };
    json = await inflate(bytes, MAX_JSON_BYTES);
    if (!json) return { ok: false, error: INVALID };
  } else if (bytes.length > MAX_JSON_BYTES) {
    return { ok: false, error: INVALID };
  }

  let data: unknown;
  try {
    data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(json));
  } catch {
    return { ok: false, error: INVALID };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, error: INVALID };

  const parsed = StrictRequirementsSchema.safeParse(data);
  if (!parsed.success) return { ok: false, error: 'The link contains requirements this app does not accept, so it was ignored.' };
  return { ok: true, requirements: parsed.data };
}

/** Returns the share payload from a location hash such as "#r=z...", or null if the hash is not a share link. */
export function readShareHash(hash: string): string | null {
  const body = hash.startsWith('#') ? hash.slice(1) : hash;
  const prefix = `${SHARE_PARAM}=`;
  return body.startsWith(prefix) ? body.slice(prefix.length) : null;
}

/** Builds a full share URL from a base URL (any existing fragment is replaced). */
export async function buildShareUrl(base: string, req: Requirements): Promise<string> {
  return `${base.split('#')[0]}#${SHARE_PARAM}=${await encodeRequirements(req)}`;
}
