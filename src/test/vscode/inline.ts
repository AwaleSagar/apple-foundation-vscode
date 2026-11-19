import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { completionLanguages } from '../../inline/completion';
import { CommentCompletionProvider } from '../../inline/provider';
import type { NativeClient } from '../../native/client';

const explicit: vscode.InlineCompletionContext = {
  triggerKind: vscode.InlineCompletionTriggerKind.Invoke,
  selectedCompletionInfo: undefined,
};
const automatic = { ...explicit, triggerKind: vscode.InlineCompletionTriggerKind.Automatic };
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const ready = async () => ({ context: 4096, exact: true, reason: undefined });

suite('comment completion provider', () => {
  test('activation covers every supported language and the setting defaults on', () => {
    const manifest = vscode.extensions.getExtension(
      'sagarawale.apple-foundation-vscode',
    )?.packageJSON;
    for (const language of completionLanguages)
      assert.ok(manifest.activationEvents.includes(`onLanguage:${language}`));
    assert.equal(
      vscode.workspace.getConfiguration('appleFoundation.inlineCompletions').get('enabled'),
      true,
    );
  });

  test('sends the document language and nearby names, and returns a single replacement for the blank line', async () => {
    const document = await vscode.workspace.openTextDocument({
      language: 'python',
      content: 'def clean(names):\r\n    # Filter names\r\n    \r\n    log(names)',
    });
    const token = new vscode.CancellationTokenSource();
    const calls: string[] = [];
    const provider = new CommentCompletionProvider({
      generating: false,
      status: ready,
      generate: async (messages, _limits, _token, delta) => {
        calls.push(messages.map((m) => m.content).join('\n'));
        delta('```python\nif names:\n');
        delta('    return names\n```');
      },
    });
    try {
      assert.deepEqual(
        await provider.provideInlineCompletionItems(
          document,
          new vscode.Position(1, 4),
          automatic,
          token.token,
        ),
        [],
      );
      assert.equal(calls.length, 0);
      const items = await provider.provideInlineCompletionItems(
        document,
        new vscode.Position(2, 4),
        explicit,
        token.token,
      );
      assert.equal(calls.length, 1);
      assert.match(calls[0] ?? '', /python.*def clean\(names\).*Filter names.*log\(names\)/s);
      assert.equal(items.length, 1);
      assert.equal(items[0]?.insertText, '    if names:\r\n        return names');
      assert.ok(items[0]?.range?.isEqual(document.lineAt(2).range));
    } finally {
      provider.dispose();
      token.dispose();
    }
  });

  test('skips cancelled automatic requests and drops superseded or edited results', async () => {
    const document = await vscode.workspace.openTextDocument({
      language: 'typescript',
      content: '// Return one\n',
    });
    const position = new vscode.Position(1, 0);
    const token = new vscode.CancellationTokenSource();
    const started = signal();
    const finish = signal();
    let calls = 0;
    let generationToken: vscode.CancellationToken | undefined;
    const generate: NativeClient['generate'] = async (_messages, _limits, requestToken, delta) => {
      calls++;
      generationToken = requestToken;
      started.resolve();
      await finish.promise;
      delta('return 1;');
    };
    const provider = new CommentCompletionProvider({ generating: false, status: ready, generate });
    try {
      const delayed = provider.provideInlineCompletionItems(
        document,
        position,
        automatic,
        token.token,
      );
      const first = provider.provideInlineCompletionItems(
        document,
        position,
        explicit,
        token.token,
      );
      await started.promise;
      assert.deepEqual(await delayed, []);
      const second = provider.provideInlineCompletionItems(
        document,
        position,
        explicit,
        token.token,
      );
      assert.ok(generationToken?.isCancellationRequested);
      const edit = new vscode.WorkspaceEdit();
      edit.insert(document.uri, position, 'x');
      assert.ok(await vscode.workspace.applyEdit(edit));
      finish.resolve();
      assert.deepEqual(await first, []);
      assert.deepEqual(await second, []);
      assert.equal(calls, 2);
    } finally {
      finish.resolve();
      provider.dispose();
      token.dispose();
    }
  });

  test('skips a busy or unavailable model', async () => {
    const document = await vscode.workspace.openTextDocument({
      language: 'python',
      content: '# List files\n',
    });
    const token = new vscode.CancellationTokenSource();
    let calls = 0;
    try {
      for (const generating of [false, true]) {
        const provider = new CommentCompletionProvider({
          generating,
          status: async () => {
            if (generating) calls++;
            return { context: 4096, exact: true, reason: 'Model unavailable' };
          },
          generate: async () => {
            calls++;
          },
        });
        assert.deepEqual(
          await provider.provideInlineCompletionItems(
            document,
            new vscode.Position(1, 0),
            explicit,
            token.token,
          ),
          [],
        );
        provider.dispose();
      }
      assert.equal(calls, 0);
    } finally {
      token.dispose();
    }
  });
});

if (process.env['APPLE_LOCAL_INLINE_TEST']) {
  suite('on-device editor completions', () => {
    for (const [language, before, after, comment] of [
      [
        'python',
        'def unique_names(names):',
        '',
        '    # Return the unique names in their original order',
      ],
      [
        'typescript',
        'function total(costs: number[]) {',
        '\n}',
        '  // Use a for loop to add each cost to a running total and return it',
      ],
    ] as const) {
      test(`accepts, dismisses and disables an inline suggestion in ${language}`, async () => {
        const doc = await vscode.workspace.openTextDocument({
          language,
          content: `${before}\n${comment}${after}`,
        });
        const editor = await vscode.window.showTextDocument(doc);
        const at = doc.lineAt(1).range.end;
        editor.selection = new vscode.Selection(at, at);
        const command = (name: string) =>
          vscode.commands.executeCommand(`editor.action.inlineSuggest.${name}`);
        const start = Date.now();
        await vscode.commands.executeCommand('type', { text: '\n' });
        const original = doc.getText();
        while (doc.getText() === original && Date.now() - start < 14000) {
          await delay(100);
          await command('commit');
        }
        const generated = doc.getText();
        process.stdout.write(
          `Inline ${language}, Enter to acceptance: ${Date.now() - start} ms\n${generated}\n`,
        );
        assert.notEqual(generated, original, 'no automatic suggestion accepted');
        assert.equal(generated.split(before).length, 2);
        assert.equal(generated.split(comment).length, 2);
        assert.match(doc.lineAt(2).text, /^\s+\S/);
        assert.match(
          generated.slice(generated.indexOf(comment) + comment.length),
          language === 'python' ? /\bnames\b/ : /\bcosts\b/,
        );
        if (language === 'typescript') {
          assert.match(generated, /\bfor\s*\(/);
          assert.match(generated, /\b(?:let|var)\s+\w+(?:\s*:\s*number)?\s*=\s*0\s*;?\s*\n/);
          assert.ok(doc.lineCount >= 6);
          assert.equal(generated.match(/\{/g)?.length, generated.match(/\}/g)?.length);
          assert.ok(generated.endsWith(after));
        }
        await vscode.commands.executeCommand('undo');
        assert.equal(doc.getText(), original);
        await command('trigger');
        await command('hide');
        await command('commit');
        assert.equal(doc.getText(), original);
        const config = vscode.workspace.getConfiguration('appleFoundation.inlineCompletions', doc);
        const previous = config.inspect<boolean>('enabled')?.globalValue;
        try {
          await config.update('enabled', false, vscode.ConfigurationTarget.Global);
          await command('trigger');
          await command('commit');
          assert.equal(doc.getText(), original);
        } finally {
          await config.update('enabled', previous, vscode.ConfigurationTarget.Global);
        }
      });
    }
  });
}
