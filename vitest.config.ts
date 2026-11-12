import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup-db.ts"],
    // Semua file test memakai satu Postgres lokal, jadi dijalankan bergantian
    fileParallelism: false,
  },
});
