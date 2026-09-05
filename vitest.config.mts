import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      // No real 'vscode' package exists outside the Extension Host — see src/test/vscodeMock.ts.
      // Only affects test runs; tsc and the esbuild extension bundle both still resolve 'vscode'
      // normally (ambient @types/vscode for tsc, external for esbuild).
      vscode: path.resolve(import.meta.dirname, 'src/test/vscodeMock.ts'),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/test/**',
        // NonFunctionalRequirements.md's coverage requirement explicitly exempts thin VS Code
        // glue: activation wiring and webview HTML templates. These files are exactly that —
        // their actual decision logic lives in connectionFormLogic.ts, resolveConnectionArg.ts,
        // and applicationFormLogic.ts respectively, which ARE covered. applicationEditorHtml.ts is
        // the same kind of exemption (UC042's webview HTML/CSS/JS) — its own lifecycle logic
        // (save/revert/backup/message-handling) lives in applicationEditorProvider.ts, which is
        // NOT exempted and is covered by applicationEditorProvider.test.ts.
        'src/extension.ts',
        'src/connections/connectionFormPanel.ts',
        'src/applications/applicationEditorHtml.ts',
        'src/webview/artifactViewerPanel.ts',
      ],
      thresholds: {
        statements: 95,
        branches: 90,
        functions: 95,
        lines: 95,
      },
    },
  },
});
