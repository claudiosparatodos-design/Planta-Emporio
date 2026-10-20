import { defineConfig } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Base de datos temporal y desechable para cada ejecución de pruebas.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'planta-e2e-'));
const chromium = process.env.PW_CHROMIUM || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3200',
    locale: 'es-MX',
    timezoneId: 'America/Mexico_City',
    launchOptions: chromium ? { executablePath: chromium } : {},
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node --disable-warning=ExperimentalWarning server/index.js',
    url: 'http://localhost:3200/api/health',
    reuseExistingServer: false,
    env: { PORT: '3200', DATA_DIR: dataDir, NODE_ENV: 'production', INSECURE_COOKIES: '1', RATE_LIMIT_AUTH: '10000', DISABLE_SCHEDULER: 'true' },
  },
});
