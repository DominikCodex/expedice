const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests/e2e",
  globalTeardown: "./tests/e2e/global-teardown.js",
  workers: 2,
  outputDir: "test-results/results",
  timeout: 45_000,
  expect: { timeout: 7_500 },
  use: {
    baseURL: process.env.EXPEDICE_TEST_URL || "http://127.0.0.1:8123",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: process.env.EXPEDICE_TEST_URL
    ? undefined
    : {
        command: "node tests/e2e/static-server.js 8123",
        url: "http://127.0.0.1:8123",
        reuseExistingServer: false,
        timeout: 15_000,
      },
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
});
