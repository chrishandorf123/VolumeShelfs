import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
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
