import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

/**
 * Browser tests run in Chromium with a fake microphone. The "fake-mic" project feeds a WAV built from
 * recorded piano notes (see src/tests/e2e/global-setup.ts) through the real capture → worklet → worker path.
 * Set MOONLIGHT_CHROMIUM to use a specific Chromium binary; otherwise /usr/bin/chromium if present, else
 * Playwright's own (npx playwright install chromium).
 */
const FAKE_WAV = join(process.cwd(), 'test-results', 'fake-mic.wav');
const executablePath = process.env.MOONLIGHT_CHROMIUM ?? (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
const PORT = 5179;

export default defineConfig({
  testDir: 'src/tests/e2e',
  testMatch: '**/*.spec.ts',
  globalSetup: './src/tests/e2e/global-setup.ts',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${PORT}`, viewport: { width: 1440, height: 900 } },
  webServer: { command: `npx vite --port ${PORT} --strictPort`, url: `http://localhost:${PORT}`, reuseExistingServer: false, timeout: 60_000 },
  projects: [
    {
      name: 'fake-mic',
      testIgnore: '**/permissions.spec.ts',
      use: {
        browserName: 'chromium',
        permissions: ['microphone'],
        launchOptions: {
          ...(executablePath ? { executablePath } : {}),
          args: ['--mute-audio', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${FAKE_WAV}`, '--autoplay-policy=no-user-gesture-required'],
        },
      },
    },
    {
      name: 'mic-denied',
      testMatch: '**/permissions.spec.ts',
      use: {
        browserName: 'chromium',
        permissions: [],
        launchOptions: {
          ...(executablePath ? { executablePath } : {}),
          args: ['--mute-audio', '--use-fake-device-for-media-stream', '--deny-permission-prompts'],
        },
      },
    },
  ],
});
