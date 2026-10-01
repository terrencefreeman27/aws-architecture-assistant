export { SELECT_OPTIONS, TIER_LABELS, unsureDefaultLabel, type Option } from '../../shared/options';

export function focusField(field: string): void {
  const el = document.getElementById(`field-${field}`);
  if (!el) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
  (el as HTMLElement).focus({ preventScroll: true });
}
