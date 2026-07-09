import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

/**
 * Builds ONLY the standalone Trail page (trail.html) into dist-trail/ as a
 * single-entry bundle (one JS + one CSS file — no shared chunks), which is
 * what gets inlined into the self-contained Trail artifact.
 * Run with: npm run build:trail
 */
export default defineConfig({
  base: "./",
  build: {
    target: "es2021",
    outDir: "dist-trail",
    sourcemap: false,
    rollupOptions: {
      input: fileURLToPath(new URL("trail.html", import.meta.url)),
    },
  },
});
