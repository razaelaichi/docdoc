import { tmpdir } from "node:os";
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      MONGODB_URI: "mongodb://127.0.0.1:1/unused", // tests connect to an in-memory server instead
      CORS_ORIGINS: "http://localhost:5173",
      UPLOAD_DIR: path.join(tmpdir(), "docdoc-test-uploads"),
      JWT_ACCESS_SECRET: "test-secret-that-is-at-least-32-characters-long",
    },
  },
});
