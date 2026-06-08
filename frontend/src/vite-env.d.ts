/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "1" when the app is built for static hosting (e.g. GitHub Pages), so the
   * client fetches pre-generated JSON instead of the live Go content API. */
  readonly VITE_STATIC?: string;
}
