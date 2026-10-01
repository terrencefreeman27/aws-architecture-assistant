export { SELECT_OPTIONS, TIER_LABELS, unsureDefaultLabel, type Option } from '../../shared/options';

/** Matches the single-column layout in styles.css, where the plan sits below the requirements form. */
export const NARROW_QUERY = '(max-width: 760px)';
export const isNarrow = () => typeof window !== 'undefined' && window.matchMedia(NARROW_QUERY).matches;

/** Fired before focusing a field, so a collapsed requirements panel can open first. */
export const EXPAND_REQUIREMENTS_EVENT = 'requirements:expand';

export function focusField(field: string): void {
  window.dispatchEvent(new Event(EXPAND_REQUIREMENTS_EVENT));
  // Two frames: let the panel re-render (and become visible) before scrolling to the field.
  window.requestAnimationFrame(() =>
    window.requestAnimationFrame(() => {
      const el = document.getElementById(`field-${field}`);
      if (!el) return;
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
      el.focus({ preventScroll: true });
    }),
  );
}
