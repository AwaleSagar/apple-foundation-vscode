/**
 * Extension Host integration tests, run inside a real VS Code instance via
 * `pnpm run test:vscode` (@vscode/test-cli, mocha tdd UI). These verify the
 * wiring that unit tests cannot: activation, contribution registration, and
 * configuration defaults as VS Code actually resolves them.
 *
 * They must pass on machines without the fm CLI or Apple Intelligence — no
 * test here may require live inference.
 */
/// <reference types="mocha" />
import './inline';
import './commentReview';
import './inlineEdit';
import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { NativeClient } from '../../native/client';

const EXTENSION_ID = 'sagarawale.apple-foundation-vscode';

const CONTRIBUTED_COMMANDS = [
  'appleFoundation.editInline',
  'appleFoundation.previewInlineEdit',
  'appleFoundation.cancelInlineEdit',
  'appleFoundation.useReference',
  'appleFoundation.clearReference',
  'appleFoundation.implementComment',
  'appleFoundation.applyImplementation',
  'appleFoundation.discardImplementation',
  'appleFoundation.openChat',
  'appleFoundation.newChat',
  'appleFoundation.stop',
  'appleFoundation.draftCommit',
  'appleFoundation.documentSelection',
  'appleFoundation.explainSelection',
  'appleFoundation.manage',
  'appleFoundation.showStatus',
  'appleFoundation.restartServer',
  'appleFoundation.showLogs',
  'appleFoundation.runOnboarding',
];

suite('extension host integration', () => {
  test('extension is present and activates cleanly', async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, `extension ${EXTENSION_ID} not found`);
    await extension.activate();
    assert.strictEqual(extension.isActive, true);
  });

  test('all contributed commands are registered', async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension);
    await extension.activate();
    const commands = await vscode.commands.getCommands(true);
    for (const id of CONTRIBUTED_COMMANDS) {
      assert.ok(commands.includes(id), `command ${id} is not registered`);
    }
  });

  test('configuration defaults resolve through VS Code', () => {
    const config = vscode.workspace.getConfiguration('appleFoundation');
    assert.strictEqual(config.get('bridge.executablePath'), undefined);
    assert.strictEqual(config.get('model.maxOutputTokens'), 1024);
    assert.strictEqual(config.get('model.maxContextTokens'), 0);
  });

  test('chat participant and model provider are contributed', () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension);
    const contributes = extension.packageJSON.contributes as {
      chatParticipants?: { id: string }[];
      languageModelChatProviders?: { vendor: string }[];
      walkthroughs?: { id: string }[];
    };
    assert.strictEqual(contributes.chatParticipants?.[0]?.id, 'apple-foundation.chat');
    assert.strictEqual(contributes.languageModelChatProviders?.[0]?.vendor, 'apple-foundation');
    assert.strictEqual(contributes.walkthroughs?.[0]?.id, 'appleFoundation.gettingStarted');
  });

  test('setup check command runs without throwing', async () => {
    // force:true path shows a notification; executing it must not reject even
    // on hosts without the bridge CLI.
    await vscode.commands.executeCommand('appleFoundation.runOnboarding');
  });
});

// Packaged checks use a disposable repository supplied by scripts/test-package.mjs.
if (process.env['APPLE_LOCAL_PACKAGE_TEST']) {
  suite('packaged local assistant', () => {
    const run = <T = string>(name: string, ...args: unknown[]) =>
      vscode.commands.executeCommand<T>(`appleFoundation.${name}`, ...args);
    test('loads the installed VSIX and streams one answer, recalls history, stops, and restarts', async () => {
      const extension = vscode.extensions.getExtension(EXTENSION_ID);
      assert.ok(extension?.extensionPath.includes('installed/'));
      assert.match(await run('showStatus'), /On device/);
      await run('newChat');
      assert.match(
        (await run('openChat', 'Remember the word maple. Reply with only maple.')).trim(),
        /^maple[.!]?$/i,
      );
      assert.match(
        await run('openChat', 'What word did I ask you to remember? Reply with only that word.'),
        /^maple[.!]?$/i,
      );
      const long = run('openChat', 'List the integers from 1 to 500 in words.');
      await new Promise((resolve) => setTimeout(resolve, 350));
      await run('stop');
      assert.equal(await long, undefined);
      assert.match(await run('openChat', 'Return only cedar.'), /^cedar[.!]?$/i);
      assert.match(await run('restartServer'), /On device/);
      assert.match(await run('openChat', 'Return only oak.'), /^oak[.!]?$/i);
    });

    test('serves a token count and cancels queued generation during an active stream', async () => {
      const extension = vscode.extensions.getExtension(EXTENSION_ID);
      assert.ok(extension);
      const client = new NativeClient(
        vscode.Uri.joinPath(extension.extensionUri, 'dist', 'apple-local-helper').fsPath,
      );
      const active = new vscode.CancellationTokenSource();
      const queued = new vscode.CancellationTokenSource();
      try {
        const limits = { maxContextTokens: 4096, maxOutputTokens: 512 };
        const long = client.generate(
          [{ role: 'user', content: 'List the integers from 1 to 500 in words.' }],
          limits,
          active.token,
          () => {},
        );
        const interrupted = assert.rejects(long, /Cancelled/);
        const next = client.generate(
          [{ role: 'user', content: 'Return only cedar.' }],
          limits,
          queued.token,
          () => assert.fail('Queued generation produced text before cancellation'),
        );
        const discarded = assert.rejects(next, /Cancelled/);
        queued.cancel();
        assert.ok((await client.count('🌲 maple', active.token)) > 0);
        active.cancel();
        await Promise.all([interrupted, discarded]);
        assert.ok((await client.status()).context > 0);
      } finally {
        active.cancel();
        queued.cancel();
        client.dispose();
        active.dispose();
        queued.dispose();
      }
    });

    test('runs both editor actions and drafts the staged change from the requested repository', async () => {
      const { execFileSync } = await import('node:child_process');
      const folder = vscode.workspace.workspaceFolders?.[0];
      assert.ok(folder);
      const git = vscode.extensions.getExtension('vscode.git');
      assert.ok(git);
      const api = (await git.activate()).getAPI(1);
      const deadline = Date.now() + 15000;
      while (!api.getRepository(folder.uri) && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 100));
      assert.ok(api.getRepository(folder.uri));
      const file = await vscode.workspace.openTextDocument({
        language: 'swift',
        content: '[1, 2, 3].filter { $0 > 1 }\nfunc doubled(_ value: Int) -> Int { value * 2 }',
      });
      const editor = await vscode.window.showTextDocument(file);
      editor.selection = new vscode.Selection(file.lineAt(0).range.start, file.lineAt(0).range.end);
      const explain = await run('explainSelection');
      assert.match(explain, /greater than (?:one|1)|>\s*1/i);
      await vscode.window.showTextDocument(file);
      editor.selection = new vscode.Selection(file.lineAt(1).range.start, file.lineAt(1).range.end);
      const doc = await run('documentSelection');
      assert.match(doc, /doubl|twice|multipl/i);
      assert.match(doc, /^\/\/\/[^\n]+$/);
      const source = { rootUri: folder.uri };
      assert.equal(await run('draftCommit', source), undefined);
      execFileSync('git', ['add', 'config.ts'], { cwd: folder.uri.fsPath });
      const subject = await run('draftCommit', source);
      assert.match(subject, /^(feat|fix|chore|perf|refactor)(\([^)]+\))?: [^\n]+$/);
      assert.match(subject, /increas|rais|extend|bump/i);
      assert.match(subject, /timeout/i);
      assert.ok(
        execFileSync('git', ['diff', '--cached'], {
          cwd: folder.uri.fsPath,
          encoding: 'utf8',
        }).includes('5000'),
      );
    });
  });
}
