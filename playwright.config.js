import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  globalSetup: "./e2e/global-setup.js",
  workers: 1, // one in-memory API and worker behind every spec; perf numbers need a quiet machine
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: "http://localhost:5180", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: devices["Desktop Chrome"] }],
  webServer: [
    { command: "node e2e/harness.mjs", url: "http://localhost:4401", reuseExistingServer: false, timeout: 120_000 },
    // production build, served with the same /api proxy as dev
    {
      command: "npm run build -w client && npm run preview -w client -- --port 5180 --strictPort",
      url: "http://localhost:5180",
      env: { API_URL: "http://localhost:4400" },
      timeout: 120_000,
    },
  ],
});
