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
import * as assert from 'node:assert';
import * as vscode from 'vscode';

const EXTENSION_ID = 'sagarawale.apple-foundation-vscode';

const CONTRIBUTED_COMMANDS = [
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
    assert.strictEqual(config.get('bridge.executablePath'), 'fm');
    assert.strictEqual(config.get('bridge.port'), 9999);
    assert.strictEqual(config.get('bridge.autoStart'), true);
    assert.strictEqual(config.get('bridge.idleTimeoutMinutes'), 5);
    assert.strictEqual(config.get('model.maxOutputTokens'), 1024);
    assert.strictEqual(config.get('model.maxContextTokens'), 4096);
    assert.strictEqual(config.get('offlineOnlyMode'), false);
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
