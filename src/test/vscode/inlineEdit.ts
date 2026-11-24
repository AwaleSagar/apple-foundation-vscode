import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { generateInlineEdit } from '../../inline/editGeneration';
import type { NativeClient } from '../../native/client';

suite('inline edits', () => {
  test('generates against exact selection boundaries, including insertion, whole lines and deletion', async () => {
    const document = await vscode.workspace.openTextDocument({
      language: 'typescript',
      content: 'let n = 1;\r\nuse(n);\r\n',
    });
    const source = new vscode.CancellationTokenSource();
    let reply = '<edit>2</edit>';
    let prompt = '';
    const generate: NativeClient['generate'] = async (messages, _limits, token, delta) => {
      assert.equal(token, source.token);
      prompt = messages[1]?.content ?? '';
      delta(reply.slice(0, 4));
      delta(reply.slice(4));
    };
    const run = (range: vscode.Range) =>
      generateInlineEdit(
        { generate },
        { document, range, version: document.version },
        'Update n',
        4096,
        source.token,
      );
    try {
      assert.equal(await run(new vscode.Range(0, 8, 0, 9)), '2');
      assert.ok(prompt.includes('let n = <selection>1</selection>;\r\nuse(n);'));
      const atCursor = new vscode.Range(1, 0, 1, 0);
      reply = '<edit>  log(n);\n</edit>';
      assert.equal(await run(atCursor), '  log(n);\r\n');
      const wholeLine = new vscode.Range(0, 0, 1, 0);
      reply = '<edit>let n = 3;</edit>';
      assert.equal(await run(wholeLine), 'let n = 3;\r\n');
      reply = '<edit></edit>';
      assert.equal(await run(wholeLine), '');
      reply = '<edit>partial';
      await assert.rejects(run(wholeLine), /incomplete edit/);
    } finally {
      source.dispose();
    }
  });

  const { APPLE_LOCAL_INLINE_TEST, APPLE_LOCAL_PACKAGE_TEST } = process.env;
  if (APPLE_LOCAL_INLINE_TEST || APPLE_LOCAL_PACKAGE_TEST) {
    test('types into the inline prompt, reviews a substring replacement and undoes it', async () => {
      const original = 'function add(a: number, b: number) { return a - b; }';
      const doc = await vscode.workspace.openTextDocument({
        language: 'typescript',
        content: original,
      });
      const editor = await vscode.window.showTextDocument(doc);
      const start = original.indexOf('a - b');
      editor.selection = new vscode.Selection(0, start, 0, start + 5);
      const ready = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          listener.dispose();
          reject(new Error('Inline input did not open'));
        }, 5000);
        const listener = vscode.workspace.onDidOpenTextDocument((document) => {
          if (document.uri.scheme !== 'comment') return;
          clearTimeout(timer);
          listener.dispose();
          resolve();
        });
      });
      await vscode.commands.executeCommand('appleFoundation.editInline');
      await ready;
      // The renderer creates the input model before laying out and focusing its editor.
      await new Promise((resolve) => setTimeout(resolve, 300));
      await vscode.commands.executeCommand('type', {
        text: 'Replace the selected expression with a + b.',
      });
      assert.equal(doc.getText(), original, 'Typing the instruction changed the source');
      const deadline = Date.now() + 15000;
      while (
        !(
          vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputTextDiff
        )
      ) {
        assert.ok(Date.now() < deadline, 'The edit did not open a preview');
        // VS Code enables the form action after processing the input change.
        await vscode.commands.executeCommand('editor.action.submitComment');
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.equal(doc.getText(), original);
      assert.equal(
        await vscode.commands.executeCommand('appleFoundation.applyImplementation'),
        true,
      );
      assert.equal(doc.getText(), original.replace('a - b', 'a + b'));
      await vscode.commands.executeCommand('undo');
      assert.equal(doc.getText(), original);
    });
  }
});
