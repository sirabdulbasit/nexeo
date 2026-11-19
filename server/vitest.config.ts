import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    testTimeout: 10000,
    // PMO 19 Nov 2026: full runs pushed the VS Code tunnel past its 16 GB limit (13 and 16 Nov). Every caller gets 2 workers.
    maxWorkers: 2,
    // Keeps the paths the 4 Nov owner rulings switched off under test. tests/whatsappUserOnly.test.ts pins the default.
    env: { WHATSAPP_WITH_OTHERS: '1' },
  },
});
