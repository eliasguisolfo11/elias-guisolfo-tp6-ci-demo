import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    maxWorkers: 2,
    include: ['**/*.e2e-spec.ts'],
    setupFiles: ['./test/setup-e2e.ts'],
  },
});
