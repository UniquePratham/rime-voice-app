import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/** Windows-safe absolute path to this config's directory. */
const rootDir = fileURLToPath(new URL("./", import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": rootDir,
    },
  },
});