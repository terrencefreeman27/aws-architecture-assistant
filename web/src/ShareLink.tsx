import { useEffect, useRef, useState } from 'react';
import type { Requirements } from '../../shared/schema';
import { buildShareUrl } from '../../shared/share';

export const SHARE_PRIVACY_NOTE =
  'The link holds your requirements after the "#" in the URL. Browsers never send that part to any server, so only people you give the link to can read it.';

type Status = { kind: 'idle' } | { kind: 'copied' } | { kind: 'manual'; link: string } | { kind: 'error' };

/** Copy-link state, shared by the button (in the header) and the fallback field (below it). */
export function useShareLink(requirements: Requirements) {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async () => {
    window.clearTimeout(timer.current);
    let link: string;
    try {
      link = await buildShareUrl(window.location.href, requirements);
    } catch {
      setStatus({ kind: 'error' });
      return;
    }
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
      await navigator.clipboard.writeText(link);
      setStatus({ kind: 'copied' });
      timer.current = window.setTimeout(() => setStatus({ kind: 'idle' }), 2500);
    } catch {
      // Clipboard blocked (permissions, insecure context, older browser): show the link to copy by hand.
      setStatus({ kind: 'manual', link });
    }
  };

  return { status, copy, dismiss: () => setStatus({ kind: 'idle' }) };
}

export function CopyLinkButton({ share }: { share: ReturnType<typeof useShareLink> }) {
  return (
    <button type="button" className="btn-secondary" onClick={() => void share.copy()} title={SHARE_PRIVACY_NOTE} data-testid="copy-link">
      {share.status.kind === 'copied' ? 'Link copied' : 'Copy link'}
    </button>
  );
}

export function ShareFallback({ share }: { share: ReturnType<typeof useShareLink> }) {
  const { status } = share;
  return (
    <div aria-live="polite">
      {status.kind === 'manual' && (
        <div className="share-panel" data-testid="share-fallback">
          <label htmlFor="share-link-field">Copying isn't available here. Select the link and copy it:</label>
          <div className="share-row">
            <input id="share-link-field" type="text" readOnly value={status.link} onFocus={(e) => e.currentTarget.select()} autoFocus />
            <button type="button" className="btn-quiet" onClick={share.dismiss}>
              Done
            </button>
          </div>
          <p className="hint">{SHARE_PRIVACY_NOTE}</p>
        </div>
      )}
      {status.kind === 'error' && (
        <div className="callout is-error" role="alert">
          <p>The share link could not be created in this browser.</p>
        </div>
      )}
    </div>
  );
}
