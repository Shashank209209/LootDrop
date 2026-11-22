import { defineConfig } from '@playwright/test';

const host = 'http://127.0.0.1:4176';
const api = 'http://127.0.0.1:4177';
const guarded = process.env.PHASE6_TEST_GUARD === '1';

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: host,
    browserName: 'chromium',
    actionTimeout: 8000,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  projects: [
    { name: 'mocked', testIgnore: ['**/live.smoke.spec.ts', '**/screenshots.spec.ts'] },
    { name: 'screenshots', testMatch: '**/screenshots.spec.ts' },
    ...(guarded ? [{ name: 'smoke', testMatch: '**/live.smoke.spec.ts' }] : []),
  ],
  webServer: [
    ...(guarded
      ? [
          {
            command: 'node --import tsx apps/api/src/server.ts',
            url: api + '/health',
            env: {
              API_PORT: '4177',
              WEB_ORIGIN: host,
              AUTH_COOKIE_SECURE: 'false',
              AUTH_COOKIE_SAME_SITE: 'lax',
              LOG_LEVEL: 'silent',
            },
            reuseExistingServer: false,
          },
        ]
      : []),
    {
      command:
        'node node_modules/vite/bin/vite.js apps/web --host 127.0.0.1 --port 4176 --strictPort',
      url: host,
      env: { VITE_API_BASE_URL: '/api/v1', VITE_API_PROXY_TARGET: api },
      reuseExistingServer: false,
    },
  ],
});
