import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Default to node; renderer/integration tests opt into jsdom per-file via:
    //   // @vitest-environment jsdom
    // (or set environment here to 'jsdom' if most tests need DOM).
    environment: 'node',
    include: ['**/*.{test,_test}.ts'],
    exclude: ['PK/**', 'node_modules/**'],
    // The project convention: tests are deterministic; perf numbers are NOT
    // validated here (that's real-hardware / Claude Code work).
    globals: false,
  },
})
