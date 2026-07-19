import * as vscode from 'vscode';
import { applyResolvedHunksToText, resolveEditPlan } from './resolve';
import {
  clearLastApplied,
  clearStagedEdit,
  getLastApplied,
  getStagedEdit,
  rememberApplied,
  type StagedEdit,
} from './session';
import type { ApplyResult, EditPlan, FileApplyOutcome } from './types';

/**
 * Apply a previously staged (and resolved) edit plan via WorkspaceEdit.
 * Uses native VS Code undo. Snapshots originals for rollbackLast.
 */
export async function applyStagedEdit(): Promise<ApplyResult> {
  const staged = getStagedEdit();
  if (staged === undefined) {
    return { applied: false, outcomes: [], error: 'No staged edit plan to apply' };
  }
  if (staged.outcomes.some((o) => !o.ok)) {
    return {
      applied: false,
      outcomes: staged.outcomes,
      error: 'Staged plan has unresolved match failures',
    };
  }

  const edit = new vscode.WorkspaceEdit();
  const touched: string[] = [];

  for (const outcome of staged.outcomes) {
    const abs = staged.absoluteByRelative.get(outcome.path);
    if (abs === undefined) {
      return {
        applied: false,
        outcomes: staged.outcomes,
        error: `Missing absolute path for ${outcome.path}`,
      };
    }
    const uri = vscode.Uri.file(abs);
    touched.push(abs);

    if (outcome.action === 'delete') {
      edit.deleteFile(uri, { ignoreIfNotExists: false });
      continue;
    }

    if (outcome.action === 'create') {
      const content = staged.previewByAbsolutePath.get(abs) ?? '';
      edit.createFile(uri, { ignoreIfExists: false, overwrite: false });
      edit.insert(uri, new vscode.Position(0, 0), content);
      continue;
    }

    // update
    const original = staged.originalByAbsolutePath.get(abs);
    const preview = staged.previewByAbsolutePath.get(abs);
    if (original === undefined || preview === undefined) {
      return {
        applied: false,
        outcomes: staged.outcomes,
        error: `Missing content for ${outcome.path}`,
      };
    }

    const doc = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === abs);
    if (doc !== undefined) {
      const fullRange = new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length));
      // Prefer range replaces from resolved hunks when possible for smaller undo steps
      if (outcome.resolved !== undefined && outcome.resolved.length > 0) {
        // Apply hunks high-to-low as separate replaces on the open document text
        const ordered = [...outcome.resolved].sort((a, b) => b.start - a.start);
        for (const hunk of ordered) {
          const range = new vscode.Range(doc.positionAt(hunk.start), doc.positionAt(hunk.end));
          edit.replace(uri, range, hunk.replace);
        }
      } else {
        edit.replace(uri, fullRange, preview);
      }
    } else {
      // File not open: whole-content write via replace of full range after open-from-disk
      const bytes = await vscode.workspace.fs.readFile(uri);
      const text = new TextDecoder('utf-8').decode(bytes);
      // Use a single full-document replace via WorkspaceEdit by creating a temporary doc range:
      // WorkspaceEdit.replace requires positions; open as TextDocument for positioning.
      const opened = await vscode.workspace.openTextDocument(uri);
      const fullRange = new vscode.Range(
        opened.positionAt(0),
        opened.positionAt(opened.getText().length),
      );
      const next =
        outcome.resolved !== undefined && outcome.resolved.length > 0
          ? applyResolvedHunksToText(text, outcome.resolved)
          : preview;
      edit.replace(uri, fullRange, next);
    }
  }

  const ok = await vscode.workspace.applyEdit(edit, { isRefactoring: true });
  if (!ok) {
    return {
      applied: false,
      outcomes: staged.outcomes,
      error: 'VS Code rejected the workspace edit',
    };
  }

  rememberApplied({
    plan: staged.plan,
    originalByAbsolutePath: staged.originalByAbsolutePath,
    absolutePaths: touched,
    appliedAt: Date.now(),
  });
  clearStagedEdit();

  return { applied: true, outcomes: staged.outcomes };
}

/**
 * Restore files from the last successful apply snapshot.
 */
export async function rollbackLastApplied(): Promise<ApplyResult> {
  const last = getLastApplied();
  if (last === undefined) {
    return { applied: false, outcomes: [], error: 'Nothing to roll back' };
  }

  const edit = new vscode.WorkspaceEdit();
  const outcomes: FileApplyOutcome[] = [];

  for (const abs of last.absolutePaths) {
    const original = last.originalByAbsolutePath.get(abs);
    const uri = vscode.Uri.file(abs);
    if (original === undefined) {
      // create was applied — delete the file
      edit.deleteFile(uri, { ignoreIfNotExists: true });
      outcomes.push({ path: abs, action: 'delete', ok: true });
      continue;
    }
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      const fullRange = new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length));
      edit.replace(uri, fullRange, original);
      outcomes.push({ path: abs, action: 'update', ok: true });
    } catch {
      // File may have been deleted — recreate
      edit.createFile(uri, { ignoreIfExists: true, overwrite: true });
      edit.insert(uri, new vscode.Position(0, 0), original);
      outcomes.push({ path: abs, action: 'create', ok: true });
    }
  }

  const ok = await vscode.workspace.applyEdit(edit, { isRefactoring: true });
  if (ok) {
    clearLastApplied();
  }
  return {
    applied: ok,
    outcomes,
    error: ok ? undefined : 'VS Code rejected the rollback edit',
  };
}

/**
 * Load workspace contents for a plan, resolve hunks, and return data for staging.
 * Does not mutate the workspace.
 */
export async function preparePlan(
  plan: EditPlan,
  absoluteByRelative: ReadonlyMap<string, string>,
  options?: { readonly allowFuzzy?: boolean },
): Promise<{
  readonly outcomes: FileApplyOutcome[];
  readonly allOk: boolean;
  readonly originalByAbsolutePath: Map<string, string>;
  readonly previewByAbsolutePath: Map<string, string>;
}> {
  const originalByAbsolutePath = new Map<string, string>();
  const previewByAbsolutePath = new Map<string, string>();

  // Read all targets first
  for (const change of plan.changes) {
    const abs = absoluteByRelative.get(change.path);
    if (abs === undefined) {
      continue;
    }
    const uri = vscode.Uri.file(abs);
    if (change.action === 'create') {
      previewByAbsolutePath.set(abs, change.wholeFile ?? '');
      continue;
    }
    try {
      const doc = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === abs);
      const text =
        doc !== undefined
          ? doc.getText()
          : new TextDecoder('utf-8').decode(await vscode.workspace.fs.readFile(uri));
      originalByAbsolutePath.set(abs, text);
    } catch {
      // missing file — resolve will fail for update
    }
  }

  const source = {
    read: (path: string) => {
      const abs = absoluteByRelative.get(path);
      return abs !== undefined ? originalByAbsolutePath.get(abs) : undefined;
    },
    exists: (path: string) => {
      const abs = absoluteByRelative.get(path);
      if (abs === undefined) {
        return false;
      }
      if (originalByAbsolutePath.has(abs)) {
        return true;
      }
      // create targets intentionally do not exist
      return false;
    },
  };

  // For exists check on delete/update of on-disk files we already loaded
  const { outcomes, allOk } = resolveEditPlan(plan, source, options);

  for (const outcome of outcomes) {
    const abs = absoluteByRelative.get(outcome.path);
    if (abs === undefined || !outcome.ok) {
      continue;
    }
    if (outcome.action === 'create') {
      // already set
      continue;
    }
    if (outcome.action === 'delete') {
      previewByAbsolutePath.set(abs, '');
      continue;
    }
    const original = originalByAbsolutePath.get(abs) ?? '';
    if (outcome.resolved !== undefined) {
      previewByAbsolutePath.set(abs, applyResolvedHunksToText(original, outcome.resolved));
    }
  }

  return { outcomes, allOk, originalByAbsolutePath, previewByAbsolutePath };
}

export type { StagedEdit };
