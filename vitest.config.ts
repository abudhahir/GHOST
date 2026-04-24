import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      threshold: { lines: 80, functions: 80, branches: 80, statements: 80 },
      exclude: [
        'tests/**',
        'dist/**',
        '*.config.*',
        // CLI entry points depend on interactive I/O; validated via smoke tests
        'src/index.ts',
        'src/cli/main.ts',
        'src/cli/config-cmd.ts',
      ],
    },
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    exclude: ['tests/e2e/**'],
  },
})
