import { EMPTY_REQUIREMENTS, RequirementsSchema, type Requirements } from '../../shared/schema';

/**
 * Autosave of the requirements form in localStorage. Every access is guarded:
 * storage can be disabled, full, or throw in private modes, and the app must
 * keep working without it. Saved data is re-validated on load.
 */
const KEY = 'aws-architecture-assistant:requirements:v1';

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function loadAutosave(): Requirements | null {
  try {
    const raw = storage()?.getItem(KEY);
    if (!raw) return null;
    const parsed = RequirementsSchema.strict().safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function saveAutosave(req: Requirements): void {
  try {
    const store = storage();
    if (!store) return;
    if (JSON.stringify(req) === JSON.stringify(EMPTY_REQUIREMENTS)) store.removeItem(KEY);
    else store.setItem(KEY, JSON.stringify(req));
  } catch {
    // Storage blocked or full: autosave is best-effort.
  }
}
