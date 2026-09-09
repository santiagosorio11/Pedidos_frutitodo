import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  reporter: "html",
  use: {
    baseURL: "http://127.0.0.1:3108",
    trace: "on-first-retry",
  },
  webServer: {
    command: "npm.cmd run dev -- --port 3108",
    url: "http://127.0.0.1:3108",
    reuseExistingServer: true,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
