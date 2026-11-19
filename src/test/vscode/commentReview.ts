import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';

const implement = 'appleFoundation.implementComment';
const kind = 'refactor.rewrite.appleFoundation.implementComment';
const cmd = (suffix: string) => vscode.commands.executeCommand(`appleFoundation.${suffix}`);
async function actions(document: vscode.TextDocument, start: number, end = start) {
  const range = new vscode.Range(start, 0, end, document.lineAt(end).range.end.character);
  const all = await vscode.commands.executeCommand<vscode.CodeAction[]>(
    'vscode.executeCodeActionProvider',
    document.uri,
    range,
    kind,
  );
  return all.filter((action) => action.command?.command === implement);
}

suite('comment implementation review', () => {
  test('offers the lightbulb on a comment and excludes unrelated selections', async () => {
    await vscode.extensions.getExtension('sagarawale.apple-foundation-vscode')?.activate();
    const doc = await vscode.workspace.openTextDocument({
      language: 'typescript',
      content: '/*\n * Compute the sum.\n */\nuse(sum);\n\n// Do something else.',
    });
    await vscode.window.showTextDocument(doc);
    // Older hosts can finish activation before the renderer receives the provider registration.
    const deadline = Date.now() + 4000;
    let [action] = await actions(doc, 1);
    while (!action && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 40));
      [action] = await actions(doc, 1);
    }
    assert.deepEqual(action?.command?.arguments, [doc.uri, doc.version, 0]);
    assert.equal((await actions(doc, 0, 5)).length, 0);
    assert.equal((await actions(doc, 3)).length, 0);
  });

  const { APPLE_LOCAL_INLINE_TEST, APPLE_LOCAL_PACKAGE_TEST } = process.env;
  if (APPLE_LOCAL_INLINE_TEST || APPLE_LOCAL_PACKAGE_TEST) {
    test('reviews a focused diff, applies in one undo step, discards and rejects stale edits', async () => {
      const original =
        '# Define double_value(value) and return value * 2.\n\n# Define unrelated_task().';
      const doc = await vscode.workspace.openTextDocument({
        language: 'python',
        content: original,
      });
      async function propose() {
        const editor = await vscode.window.showTextDocument(doc);
        const pos = new vscode.Position(0, 4);
        editor.selection = new vscode.Selection(pos, pos);
        const uri = await vscode.commands.executeCommand<vscode.Uri>(implement);
        assert.ok(uri);
        const preview = await vscode.workspace.openTextDocument(uri);
        const deadline = Date.now() + 4000;
        while (Date.now() < deadline) {
          const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
          if (
            input instanceof vscode.TabInputTextDiff &&
            input.modified.toString() === uri.toString()
          )
            return preview;
          await new Promise((resolve) => setTimeout(resolve, 30));
        }
        throw new Error('Proposal diff did not become active');
      }
      const sample = await vscode.workspace.openTextDocument({
        language: 'python',
        content: 'def triple(x):\n    return x * 3',
      });
      const sampleEditor = await vscode.window.showTextDocument(sample);
      sampleEditor.selection = new vscode.Selection(
        new vscode.Position(0, 0),
        sample.lineAt(1).range.end,
      );
      await cmd('useReference');
      const preview = await propose();
      assert.match(vscode.window.tabGroups.activeTabGroup.activeTab?.label ?? '', /using /);
      const proposedText = preview.getText();
      assert.equal(doc.getText(), original);
      assert.equal(preview.languageId, 'python');
      assert.match(proposedText, /def double_value\(value\)/);
      assert.doesNotMatch(proposedText, /def unrelated_task/);
      assert.equal(await cmd('applyImplementation'), true);
      assert.equal(doc.getText(), proposedText);
      await vscode.commands.executeCommand('undo');
      assert.equal(doc.getText(), original);

      await propose();
      assert.doesNotMatch(vscode.window.tabGroups.activeTabGroup.activeTab?.label ?? '', /using /);
      await cmd('discardImplementation');
      assert.equal(doc.getText(), original);

      await propose();
      const change = new vscode.WorkspaceEdit();
      change.insert(doc.uri, new vscode.Position(0, 0), '# New edit\n');
      assert.ok(await vscode.workspace.applyEdit(change));
      assert.equal(await cmd('applyImplementation'), false);
      assert.equal(doc.getText(), `# New edit\n${original}`);
      await cmd('discardImplementation');
    });
  }
});
