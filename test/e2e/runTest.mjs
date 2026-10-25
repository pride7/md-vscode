// Runs the integration suite in a real VS Code instance with a throwaway profile.
// Set VSCODE_EXECUTABLE to test against an installed VS Code instead of downloading one.
import { runTests } from '@vscode/test-electron';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const sandbox = mkdtempSync(join(tmpdir(), 'md-wysiwyg-e2e-'));
mkdirSync(join(sandbox, 'workspace'));
// Set when this runs from VS Code's integrated terminal; it would start Code.exe as plain Node.
delete process.env.ELECTRON_RUN_AS_NODE;

try {
  await runTests({
    vscodeExecutablePath: process.env.VSCODE_EXECUTABLE || undefined,
    extensionDevelopmentPath: resolve(here, '../..'),
    extensionTestsPath: resolve(here, 'suite.cjs'),
    extensionTestsEnv: { MD_WYSIWYG_WORKSPACE: join(sandbox, 'workspace') },
    launchArgs: [
      join(sandbox, 'workspace'),
      '--disable-extensions',
      '--disable-workspace-trust',
      '--skip-welcome',
      '--skip-release-notes',
      `--user-data-dir=${join(sandbox, 'user-data')}`,
      `--extensions-dir=${join(sandbox, 'extensions')}`,
    ],
  });
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  rmSync(sandbox, { recursive: true, force: true, maxRetries: 5 });
}
