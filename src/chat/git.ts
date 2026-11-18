import * as vscode from 'vscode';

interface Repository {
  rootUri: vscode.Uri;
  diff(cached: boolean): Promise<string>;
  ui?: { selected: boolean };
}
interface Git {
  getAPI(version: 1): {
    repositories: readonly Repository[];
    getRepository(uri: vscode.Uri): Repository | null;
  };
}

export async function getStagedDiff(source?: {
  rootUri?: vscode.Uri | undefined;
}): Promise<string> {
  const extension = vscode.extensions.getExtension<Git>('vscode.git');
  if (!extension) throw new Error('Enable the built-in Git extension to draft a commit.');
  const api = (await extension.activate()).getAPI(1);
  const active = vscode.window.activeTextEditor?.document.uri;
  const selected = api.repositories.filter((repo) => repo.ui?.selected);
  let repo = source?.rootUri
    ? api.getRepository(source.rootUri)
    : ((selected.length === 1 ? selected[0] : undefined) ?? (active && api.getRepository(active)));
  if (!repo && !source?.rootUri && api.repositories.length > 1) {
    const choice = await vscode.window.showQuickPick(
      api.repositories.map((repo) => ({ label: repo.rootUri.fsPath, repo })),
      { placeHolder: 'Choose a repository for the staged diff' },
    );
    if (!choice) throw new Error('Repository selection cancelled.');
    repo = choice.repo;
  }
  if (!repo && !source?.rootUri) repo = api.repositories[0];
  if (!repo) throw new Error('Open a Git repository to draft a commit.');
  const diff = await repo.diff(true);
  if (!diff.trim())
    throw new Error('No staged changes. Stage the changes to summarize and try again.');
  return diff;
}
