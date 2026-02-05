import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          bindings: {
            API_KEYS: 'test-key-1,test-key-2',
            ENVIRONMENT: 'test',
          },
        },
      },
    },
  },
});
