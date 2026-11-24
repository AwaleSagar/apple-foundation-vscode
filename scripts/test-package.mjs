// Run the same host suite against an installed VSIX in a new, disposable profile.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { resolveCliArgsFromVSCodeExecutablePath } from '@vscode/test-electron';

const [vsix, executable] = process.argv.slice(2);
if (!vsix || !executable)
  throw new Error('Usage: node scripts/test-package.mjs <vsix> <VS Code executable>');
const root = mkdtempSync(join(realpathSync(tmpdir()), 'apple-local-package-'));
try {
  const folder = join(root, 'repo');
  const driver = join(root, 'driver');
  const profile = join(root, 'profile');
  for (const dir of [folder, driver, join(profile, 'User')]) mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(profile, 'User', 'settings.json'),
    JSON.stringify({
      'security.workspace.trust.enabled': false,
      'telemetry.telemetryLevel': 'off',
      'update.mode': 'none',
      'git.autofetch': false,
      'git.path': '/usr/bin/git',
      'chat.disableAIFeatures': true,
    }),
  );
  writeFileSync(
    join(driver, 'package.json'),
    JSON.stringify({
      name: 'local-test-driver',
      publisher: 'test',
      version: '1.0.0',
      engines: { vscode: '^1.104.0' },
    }),
  );
  const git = (...args) => execFileSync('/usr/bin/git', args, { cwd: folder });
  git('init', '-q');
  writeFileSync(join(folder, 'config.ts'), 'const timeoutMs = 2000;\n');
  git('add', 'config.ts');
  git(
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-qm',
    'fixture',
  );
  writeFileSync(join(folder, 'config.ts'), 'const timeoutMs = 5000;\n');
  const flags = ['--user-data-dir', profile, '--extensions-dir', join(root, 'installed')];
  const [cli, ...args] = resolveCliArgsFromVSCodeExecutablePath(executable, {
    reuseMachineInstall: true,
  });
  execFileSync(cli, [...args, ...flags, '--install-extension', resolve(vsix)], {
    stdio: 'inherit',
  });
  // vscode-test-cli supplies the Mocha harness when testing the source. Provide
  // an equivalent runner here, with only the empty driver in development mode.
  const runner = join(driver, 'run.cjs');
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const mocha = createRequire(require.resolve('@vscode/test-cli')).resolve('mocha');
  writeFileSync(
    runner,
    `exports.run=async()=>{const Mocha=require(${JSON.stringify(mocha)}); const suite=new Mocha({ui:'tdd',timeout:60000});suite.addFile(${JSON.stringify(resolve('dist-test/extension.test.js'))});await new Promise((res,rej)=>suite.run(n=>n?rej(Error(n+' failures')):res()));};`,
  );
  const { status, error } = spawnSync(
    executable,
    [
      ...flags,
      '--disable-updates',
      '--skip-welcome',
      '--skip-release-notes',
      '--disable-workspace-trust',
      `--extensionDevelopmentPath=${driver}`,
      `--extensionTestsPath=${runner}`,
      folder,
    ],
    { env: { ...process.env, APPLE_LOCAL_PACKAGE_TEST: '1' }, stdio: 'inherit', timeout: 180000 },
  );
  if (error) throw error;
  process.exitCode = status ?? 1;
} finally {
  rmSync(root, { recursive: true, force: true });
}
