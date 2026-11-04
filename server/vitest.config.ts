import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    testTimeout: 10000,
    // Keeps the paths the 4 Nov owner rulings switched off under test. tests/whatsappUserOnly.test.ts pins the default.
    env: { WHATSAPP_WITH_OTHERS: '1' },
  },
});
