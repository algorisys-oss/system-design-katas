import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// We consume the in-house zen-ui library from the local clone's built `dist/`
// (its sibling node_modules resolves the library's type deps). The clone tracks
// the workflow dev -> test -> merge main -> push; run `bun run build:lib` in the
// clone after a change. The clone path is overridable via ZEN_UI_DIST. dedupe
// (below) keeps a single React instance. See plan.md §11.4.
const ZEN_DIST =
  process.env.ZEN_UI_DIST ??
  resolve(import.meta.dirname, "../../../../work/algo/zen-ui/packages/react/dist");

export default defineConfig({
  // Default "/" for dev and real-server deploys. For GitHub Pages (project
  // site), the publish script sets VITE_BASE=/system-design-katas/.
  base: process.env.VITE_BASE ?? "/",
  plugins: [react()],
  resolve: {
    // zen-ui's prebuilt dist imports React as an external; dedupe ensures the
    // app and the aliased lib share ONE React copy (else the production bundle
    // hits "Cannot read properties of null (reading 'useRef')").
    dedupe: ["react", "react-dom"],
    alias: {
      // Most specific first.
      "@algorisys/zen-ui-react/styles": resolve(ZEN_DIST, "style.css"),
      "@algorisys/zen-ui-react": resolve(ZEN_DIST, "index.js"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8080",
    },
  },
});
