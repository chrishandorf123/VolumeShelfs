import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  // Pin the dev server to ONE port so the browser origin never changes.
  // Your saved data (positions, watchlist, keys) is stored per-origin, and
  // origin includes the port — a silent jump to 5174 looks like "data gone".
  // strictPort makes a second instance ERROR ("port in use") instead of
  // quietly moving to a new, empty port. Stop the other terminal, not confused.
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    target: "es2021",
    outDir: "dist",
    sourcemap: true,
  },
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
