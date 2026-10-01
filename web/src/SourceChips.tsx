import { getSource } from '../../shared/sources';

/** Renders citations. Only ids present in the curated registry are shown. */
export function SourceChips({ ids }: { ids: string[] }) {
  const sources = ids.map((id) => getSource(id)).filter((s) => s !== undefined);
  if (sources.length === 0) return null;
  return (
    <span className="chips">
      {sources.map((s) => (
        <a key={s.id} className="chip" href={s.url} target="_blank" rel="noreferrer noopener" title={s.title}>
          {shortTitle(s.title)}
        </a>
      ))}
    </span>
  );
}

function shortTitle(title: string): string {
  return title
    .replace(/^What (is|Is) /, '')
    .replace(/^(an?|the) /i, '')
    .replace(/\?$/, '')
    .replace(' - AWS Well-Architected Framework', ' (WA)')
    .replace(/^Overview - /, '');
}
