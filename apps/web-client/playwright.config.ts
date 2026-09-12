import { defineConfig } from "@playwright/test";

export default defineConfig({
  forbidOnly: true,
  fullyParallel: false,
  projects: [
    { name: "desktop", use: { viewport: { height: 800, width: 1280 } } },
    { name: "mobile", use: { viewport: { height: 844, width: 390 } } },
  ],
  retries: 0,
  testDir: "./e2e",
  use: {
    baseURL: "http://localhost:3012",
    browserName: "chromium",
    storageState: ".auth/instant-nav.json",
  },
  webServer: {
    command: "bun run start:e2e",
    reuseExistingServer: false,
    url: "http://localhost:3012/sign-in",
  },
  workers: 1,
});
