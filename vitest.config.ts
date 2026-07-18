import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // Unit tests never touch the real VS Code API; modules that import it
      // get a lightweight stub so they stay unit-testable outside the editor.
      vscode: fileURLToPath(new URL('./src/test/mocks/vscode.ts', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/test/**', 'src/extension.ts'],
      reporter: ['text', 'lcov'],
    },
  },
});
