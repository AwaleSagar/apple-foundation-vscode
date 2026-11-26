import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import * as vscode from 'vscode';
import type { NativeClient } from '../native/client';
import type { DeviceContext } from './generation';

export const proposalScheme = 'apple-foundation-proposal';
export const EXPIRED_PROPOSAL_MESSAGE =
  '// This proposal expired when the window reloaded. Generate a new proposal from the source file.\n';
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

function proposalTabUri(tab: vscode.Tab | undefined): vscode.Uri | undefined {
  const input = tab?.input;
  if (input instanceof vscode.TabInputTextDiff) {
    if (input.modified.scheme === proposalScheme) return input.modified;
    if (input.original.scheme === proposalScheme) return input.original;
  }
  if (input instanceof vscode.TabInputText && input.uri.scheme === proposalScheme) {
    return input.uri;
  }
  return undefined;
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
  private readonly applying = new Set<string>();
  private readonly registrations: vscode.Disposable;

  constructor(private readonly client: Pick<NativeClient, 'status'>) {
    const syncContext = () => {
      const uri = proposalUri(vscode.window.tabGroups.activeTabGroup.activeTab);
      const active = uri !== undefined && this.proposals.has(uri.toString());
      void vscode.commands.executeCommand('setContext', proposalContextKey, active);
    };
    this.registrations = vscode.Disposable.from(
      vscode.workspace.registerTextDocumentContentProvider(proposalScheme, {
        provideTextDocumentContent: (uri) =>
          this.proposals.get(uri.toString())?.preview ?? EXPIRED_PROPOSAL_MESSAGE,
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
    this.closeOrphanedTabs();
    syncContext();
  }

  private closeOrphanedTabs() {
    const orphaned = vscode.window.tabGroups.all.flatMap((group) =>
      group.tabs.filter((tab) => {
        const uri = proposalTabUri(tab);
        return uri !== undefined && !this.proposals.has(uri.toString());
      }),
    );
    if (orphaned.length) {
      void Promise.resolve(vscode.window.tabGroups.close(orphaned)).catch(() => undefined);
    }
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
    const key = uri?.toString();
    const proposal = key ? this.proposals.get(key) : undefined;
    if (!uri || !key || !proposal || this.applying.has(key)) return;
    this.applying.add(key);
    try {
      const { target, text } = proposal;
      if (current(target)) {
        const editor = await vscode.window.showTextDocument(target.document);
        if (current(target) && (await editor.edit((edit) => edit.replace(target.range, text)))) {
          this.proposals.delete(key);
          await vscode.window.tabGroups.close(tabsFor(uri));
          return true;
        }
      }
      void vscode.window.showWarningMessage(
        'The edit could not be applied. Check that the source is writable and generate a new proposal.',
      );
      return false;
    } finally {
      this.applying.delete(key);
    }
  }

  dispose() {
    this.registrations.dispose();
    this.proposals.clear();
    this.applying.clear();
    void vscode.commands.executeCommand('setContext', proposalContextKey, false);
  }
}
