import * as vscode from 'vscode';

/**
 * Minimal shape of the built-in Git extension API we rely on. Modeled locally
 * to avoid a dependency on the (untyped-by-default) `vscode.git` exports.
 */
interface GitRepository {
  readonly rootUri: vscode.Uri;
  diff(cached?: boolean): Promise<string>;
}

interface GitApi {
  readonly repositories: readonly GitRepository[];
}

interface GitExtensionExports {
  getAPI(version: 1): GitApi;
}

function pickRepository(api: GitApi): GitRepository | undefined {
  const repos = api.repositories;
  if (repos.length === 0) {
    return undefined;
  }
  // Prefer the repository containing the active editor's file.
  const activeUri = vscode.window.activeTextEditor?.document.uri;
  if (activeUri !== undefined) {
    const match = repos.find((repo) => activeUri.fsPath.startsWith(repo.rootUri.fsPath));
    if (match !== undefined) {
      return match;
    }
  }
  return repos[0];
}

/**
 * Return the staged (index-vs-HEAD) diff for the most relevant repository, or
 * `undefined` when Git is unavailable, has no repository, or nothing is staged.
 */
export async function getStagedDiff(): Promise<string | undefined> {
  const extension = vscode.extensions.getExtension<GitExtensionExports>('vscode.git');
  if (extension === undefined) {
    return undefined;
  }
  const exports = extension.isActive ? extension.exports : await extension.activate();
  const api = exports.getAPI(1);
  const repo = pickRepository(api);
  if (repo === undefined) {
    return undefined;
  }
  const diff = await repo.diff(true);
  return diff.trim() === '' ? undefined : diff;
}
