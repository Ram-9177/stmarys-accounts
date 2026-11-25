import { generateKeyPairSync } from 'node:crypto';
import { defineConfig } from 'vitest/config';

/** Stand-in for the UOS auth server's signing key: tests sign module passes with it. */
const uosKeys = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const b64 = (s: string) => Buffer.from(s).toString('base64');

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/globalSetup.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/stmarys_test',
      REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/15',
      APP_ORIGIN: 'http://app.test',
      BCRYPT_ROUNDS: '4',
      ADMIN_BOOTSTRAP_PASSWORD: '',
      // UOS sign-in is on in tests; password sign-in stays on too (UOS_LEGACY_LOGIN default).
      UOS_ENABLED: 'true',
      UOS_MODULE_ID: 'accounts-test',
      UOS_AUTH_PUBLIC_KEY: b64(uosKeys.publicKey),
      TEST_UOS_PRIVATE_KEY: b64(uosKeys.privateKey),
      UOS_SHELL_URL: 'https://uos.test',
      MRF_LINK_SECRET: 'test-mrf-link-secret-0123456789',
      UOS_CAMPUS_MAP: JSON.stringify({
        'campus-ap': { code: 'AP', name: 'AP campus', colleges: ['smgg', 'smwec'] },
        'campus-hyd': { code: 'HYD', name: 'Hyderabad campus', colleges: ['smhyd'] },
      }),
    },
  },
});
