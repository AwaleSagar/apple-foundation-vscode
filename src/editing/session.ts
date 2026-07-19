import type { EditPlan, FileApplyOutcome, ResolvedHunk } from './types';

/**
 * In-memory staged edit plan for the current chat turn / user session.
 * Apply and Reject commands read from here after the participant stages a plan.
 */
export interface StagedEdit {
  readonly id: string;
  readonly plan: EditPlan;
  readonly outcomes: readonly FileApplyOutcome[];
  /** Absolute path → preview text after applying resolved hunks (for virtual docs). */
  readonly previewByAbsolutePath: ReadonlyMap<string, string>;
  /** Absolute path → original text snapshot for diff + rollback. */
  readonly originalByAbsolutePath: ReadonlyMap<string, string>;
  /** Workspace-relative path → absolute path */
  readonly absoluteByRelative: ReadonlyMap<string, string>;
  readonly createdAt: number;
}

export interface LastAppliedEdit {
  readonly plan: EditPlan;
  readonly originalByAbsolutePath: ReadonlyMap<string, string>;
  readonly absolutePaths: readonly string[];
  readonly appliedAt: number;
}

let staged: StagedEdit | undefined;
let lastApplied: LastAppliedEdit | undefined;
let idCounter = 0;

export function stageEdit(input: Omit<StagedEdit, 'id' | 'createdAt'>): StagedEdit {
  idCounter += 1;
  staged = {
    ...input,
    id: `edit-${idCounter}`,
    createdAt: Date.now(),
  };
  return staged;
}

export function getStagedEdit(): StagedEdit | undefined {
  return staged;
}

export function clearStagedEdit(): void {
  staged = undefined;
}

export function rememberApplied(edit: LastAppliedEdit): void {
  lastApplied = edit;
}

export function getLastApplied(): LastAppliedEdit | undefined {
  return lastApplied;
}

export function clearLastApplied(): void {
  lastApplied = undefined;
}

/** Build preview text map from resolved outcomes + originals. */
export function buildPreviewMap(
  absoluteByRelative: ReadonlyMap<string, string>,
  originalByAbsolutePath: ReadonlyMap<string, string>,
  outcomes: readonly FileApplyOutcome[],
  applyHunks: (original: string, hunks: readonly ResolvedHunk[]) => string,
): Map<string, string> {
  const preview = new Map<string, string>();
  for (const outcome of outcomes) {
    if (!outcome.ok) {
      continue;
    }
    const abs = absoluteByRelative.get(outcome.path);
    if (abs === undefined) {
      continue;
    }
    if (outcome.action === 'create') {
      // wholeFile is not on outcome — callers seed preview for creates
      continue;
    }
    if (outcome.action === 'delete') {
      preview.set(abs, '');
      continue;
    }
    const original = originalByAbsolutePath.get(abs) ?? '';
    if (outcome.resolved !== undefined && outcome.resolved.length > 0) {
      preview.set(abs, applyHunks(original, outcome.resolved));
    }
  }
  return preview;
}
