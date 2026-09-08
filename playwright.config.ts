import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { browserName: "chromium", headless: true, trace: "retain-on-failure", baseURL: "http://127.0.0.1:3031" },
  webServer: {
    command: "npm run start --workspace=@figmapress/web -- --hostname 127.0.0.1 --port 3031",
    url: "http://127.0.0.1:3031",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
