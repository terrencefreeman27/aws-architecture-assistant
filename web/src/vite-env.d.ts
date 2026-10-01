/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** `local` (in-browser demo planner) or `api` (server at /api). Unset: local in builds, auto in dev. */
  readonly VITE_PLANNER?: string;
}
