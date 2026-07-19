import * as vscode from 'vscode';
import { getStagedEdit } from './session';

export const PREVIEW_SCHEME = 'apple-fm-preview';

/**
 * Virtual documents holding the *proposed* post-edit content for diff views.
 * URI: apple-fm-preview:/<absolute-path-encoded>
 */
export class EditPreviewProvider implements vscode.TextDocumentContentProvider {
  private readonly emitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.emitter.event;

  provideTextDocumentContent(uri: vscode.Uri): string {
    const abs = decodePreviewPath(uri);
    const staged = getStagedEdit();
    if (staged === undefined) {
      return '// No staged Apple edit plan.\n';
    }
    return staged.previewByAbsolutePath.get(abs) ?? '// Preview unavailable for this path.\n';
  }

  refresh(uri: vscode.Uri): void {
    this.emitter.fire(uri);
  }

  refreshAll(): void {
    const staged = getStagedEdit();
    if (staged === undefined) {
      return;
    }
    for (const abs of staged.previewByAbsolutePath.keys()) {
      this.emitter.fire(previewUriFor(abs));
    }
  }
}

export function previewUriFor(absolutePath: string): vscode.Uri {
  // Use path as URI path; encode to be safe
  return vscode.Uri.from({
    scheme: PREVIEW_SCHEME,
    path: absolutePath.startsWith('/') ? absolutePath : `/${absolutePath}`,
  });
}

export function decodePreviewPath(uri: vscode.Uri): string {
  return uri.path;
}

export function registerPreviewProvider(context: vscode.ExtensionContext): EditPreviewProvider {
  const provider = new EditPreviewProvider();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(PREVIEW_SCHEME, provider),
  );
  return provider;
}

/** Open a side-by-side diff for one staged file. */
export async function openDiffForPath(absolutePath: string, title?: string): Promise<void> {
  const left = vscode.Uri.file(absolutePath);
  const right = previewUriFor(absolutePath);
  const label = title ?? `Apple edit: ${absolutePath.split('/').pop() ?? absolutePath}`;
  await vscode.commands.executeCommand('vscode.diff', left, right, label);
}

/** Open diffs for every file in the staged plan (first file focused). */
export async function openAllStagedDiffs(): Promise<void> {
  const staged = getStagedEdit();
  if (staged === undefined) {
    void vscode.window.showWarningMessage('No staged Apple edit plan.');
    return;
  }
  for (const abs of staged.previewByAbsolutePath.keys()) {
    const name = abs.split('/').pop() ?? abs;
    await openDiffForPath(abs, `${staged.plan.summary} — ${name}`);
  }
}
