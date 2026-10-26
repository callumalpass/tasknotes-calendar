import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PLAYGROUND_TEST_PORT ?? 4188);

export default defineConfig({
	testDir: "test/browser",
	fullyParallel: true,
	workers: process.env.CI ? 2 : undefined,
	forbidOnly: !!process.env.CI,
	snapshotPathTemplate: "{testDir}/__screenshots__/{testFilePath}/{arg}{ext}",
	reporter: process.env.CI ? "line" : "list",
	use: {
		baseURL: `http://127.0.0.1:${port}`,
		timezoneId: "Europe/London",
		locale: "en-GB",
		trace: "retain-on-failure",
		colorScheme: "light",
		reducedMotion: "reduce",
	},
	webServer: {
		command: `node scripts/playground.mjs --port ${port}`,
		url: `http://127.0.0.1:${port}/`,
		reuseExistingServer: false,
		stdout: "ignore",
	},
	projects: [
		{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1400, height: 900 } }, grepInvert: /@touch/ },
		{ name: "touch", use: { ...devices["Pixel 7"] }, grep: /@touch/ },
	],
});
