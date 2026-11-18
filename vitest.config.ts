import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.ts', 'tools/**/*.test.ts', 'fixtures/**/*.test.ts', 'config/**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'e2e/**'],
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      include: [
        'src/dsp/**',
        'src/follow/**',
        'src/rules/**',
        'src/grade/**',
        'src/theory/**',
        'src/corpus/**',
      ],
      exclude: ['**/*.test.ts', '**/*.d.ts', '**/.gitkeep'],
      // Coverage gate (01 section 3): 85% lines for the pure packages.
      thresholds: { lines: 85 },
    },
  },
});
