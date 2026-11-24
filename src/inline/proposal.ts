import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import * as vscode from 'vscode';
import type { NativeClient } from '../native/client';
import type { DeviceContext } from './generation';

export const proposalScheme = 'apple-foundation-proposal';
const proposalContextKey = 'appleFoundation.proposalDiffActive';

export interface EditTarget {
  document: vscode.TextDocument;
  version: number;
  range: vscode.Range;
}

function current({ document, version }: EditTarget) {
  return !document.isClosed && document.version === version;
}

function checkVersion(target: EditTarget) {
  if (!current(target)) throw new Error('The source changed. Generate a new proposal.');
}

function proposalUri(tab: vscode.Tab | undefined) {
  const input = tab?.input;
  if (input instanceof vscode.TabInputTextDiff && input.modified.scheme === proposalScheme)
    return input.modified;
}

function tabsFor(uri: vscode.Uri) {
  return vscode.window.tabGroups.all.flatMap((group) =>
    group.tabs.filter((tab) => proposalUri(tab)?.toString() === uri.toString()),
  );
}

export class ProposalReview {
  private readonly proposals = new Map<
    string,
    { target: EditTarget; text: string; preview: string }
  >();
  private readonly registrations: vscode.Disposable;

  constructor(private readonly client: Pick<NativeClient, 'status'>) {
    const syncContext = () => {
      const active = Boolean(proposalUri(vscode.window.tabGroups.activeTabGroup.activeTab));
      void vscode.commands.executeCommand('setContext', proposalContextKey, active);
    };
    this.registrations = vscode.Disposable.from(
      vscode.workspace.registerTextDocumentContentProvider(proposalScheme, {
        provideTextDocumentContent: (uri) => this.proposals.get(uri.toString())?.preview,
      }),
      vscode.commands.registerCommand('appleFoundation.applyImplementation', () => this.apply()),
      vscode.commands.registerCommand('appleFoundation.discardImplementation', () => {
        const uri = proposalUri(vscode.window.tabGroups.activeTabGroup.activeTab);
        if (uri) return vscode.window.tabGroups.close(tabsFor(uri));
      }),
      vscode.window.tabGroups.onDidChangeTabs(({ closed }) => {
        for (const tab of closed) {
          const uri = proposalUri(tab);
          if (uri && !tabsFor(uri).length) this.proposals.delete(uri.toString());
        }
        syncContext();
      }),
      vscode.window.tabGroups.onDidChangeTabGroups(syncContext),
    );
    syncContext();
  }

  async generate(
    target: EditTarget,
    label: string,
    generateText: (context: DeviceContext, token: vscode.CancellationToken) => Promise<string>,
  ) {
    try {
      checkVersion(target);
      return await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Generating an edit on your Mac…',
          cancellable: true,
        },
        async (_progress, token) => {
          const status = await this.client.status(token);
          if (token.isCancellationRequested) return;
          if (status.reason) throw new Error(status.reason);
          checkVersion(target);
          const text = await generateText({ context: status.context, exact: status.exact }, token);
          if (token.isCancellationRequested) return;
          checkVersion(target);
          if (target.document.getText(target.range) === text) {
            void vscode.window.showInformationMessage('The proposed edit matches the source.');
            return;
          }
          return this.show(target, text, label, token);
        },
      );
    } catch (error) {
      if (!(error instanceof Error && error.message === 'Cancelled.'))
        void vscode.window.showWarningMessage(
          error instanceof Error ? error.message : String(error),
        );
    }
  }

  private async show(
    target: EditTarget,
    text: string,
    label: string,
    token: vscode.CancellationToken,
  ) {
    const { document, range } = target;
    const original = document.getText();
    const name = basename(document.fileName);
    const uri = vscode.Uri.from({ scheme: proposalScheme, path: `/${randomUUID()}/${name}` });
    this.proposals.set(uri.toString(), {
      target,
      text,
      preview:
        original.slice(0, document.offsetAt(range.start)) +
        text +
        original.slice(document.offsetAt(range.end)),
    });
    try {
      const content = await vscode.workspace.openTextDocument(uri);
      if (content.languageId !== document.languageId)
        await vscode.languages.setTextDocumentLanguage(content, document.languageId);
      checkVersion(target);
      if (token.isCancellationRequested) {
        this.proposals.delete(uri.toString());
        return;
      }
      await vscode.commands.executeCommand('vscode.diff', document.uri, uri, `${name} · ${label}`, {
        preview: false,
        selection: new vscode.Range(range.start, range.start),
      });
      return uri;
    } catch (error) {
      this.proposals.delete(uri.toString());
      throw error;
    }
  }

  private async apply() {
    const uri = proposalUri(vscode.window.tabGroups.activeTabGroup.activeTab);
    const proposal = uri && this.proposals.get(uri.toString());
    if (!uri || !proposal) return;
    const { target, text } = proposal;
    if (current(target)) {
      const editor = await vscode.window.showTextDocument(target.document);
      if (current(target) && (await editor.edit((edit) => edit.replace(target.range, text)))) {
        await vscode.window.tabGroups.close(tabsFor(uri));
        return true;
      }
    }
    void vscode.window.showWarningMessage(
      'The edit could not be applied. Check that the source is writable and generate a new proposal.',
    );
    return false;
  }

  dispose() {
    this.registrations.dispose();
    this.proposals.clear();
    void vscode.commands.executeCommand('setContext', proposalContextKey, false);
  }
}
