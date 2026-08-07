import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Dummy values satisfying config/env.ts's zod schema (non-empty strings only — the actual
    // Studio DB/Redis clients are mocked in every test that touches them, so nothing here needs
    // to be a real credential).
    env: {
      REDIS_URL: "redis://localhost:6379",
      SESSION_ENCRYPTION_KEY: "dGVzdC1rZXktbm90LXVzZWQtaW4tdGhlc2UtdGVzdHM=",
      DEPLORO_AUTH_BASE_URL: "http://localhost:9999",
      DEPLORO_STUDIO_API_URL: "http://localhost:9999/studio",
      DEPLORO_STUDIO_API_TOKEN: "test-token",
    },
  },
});
