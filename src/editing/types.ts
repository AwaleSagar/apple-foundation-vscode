/**
 * Canonical intermediate representation for AI-proposed file edits.
 * Models emit this (as JSON or SEARCH/REPLACE blocks); the apply engine
 * turns it into a VS Code WorkspaceEdit after matching against live buffers.
 */

export type FileChangeAction = 'update' | 'create' | 'delete';

export type MatchStrategyName = 'exact' | 'eol' | 'ws' | 'fuzzy';

/** One search/replace hunk. Locate via content, never line numbers. */
export interface EditHunk {
  /** Exact current text to find (include enough unique context). */
  readonly search: string;
  /** Replacement text (empty string is a pure delete). */
  readonly replace: string;
  /** Optional human hint (e.g. enclosing function name) for diagnostics. */
  readonly anchorHint?: string | undefined;
}

export interface FileChange {
  /** Workspace-relative path preferred; absolute paths are also accepted. */
  readonly path: string;
  readonly action: FileChangeAction;
  readonly languageId?: string | undefined;
  /** Preferred for update: ordered, non-overlapping hunks. */
  readonly hunks?: readonly EditHunk[] | undefined;
  /** Only for create, or small-file whole rewrites when hunks are impractical. */
  readonly wholeFile?: string | undefined;
}

export interface EditPlan {
  /** Short human rationale shown in confirmations. */
  readonly summary: string;
  readonly changes: readonly FileChange[];
}

export type MatchResult =
  | {
      readonly ok: true;
      readonly start: number;
      readonly end: number;
      readonly strategy: MatchStrategyName;
    }
  | {
      readonly ok: false;
      readonly reason: string;
      readonly nearestSnippet?: string | undefined;
    };

export interface ResolvedHunk {
  readonly search: string;
  readonly replace: string;
  readonly start: number;
  readonly end: number;
  readonly strategy: MatchStrategyName;
}

export interface FileApplyOutcome {
  readonly path: string;
  readonly action: FileChangeAction;
  readonly ok: boolean;
  readonly message?: string | undefined;
  readonly hunksApplied?: number | undefined;
  readonly resolved?: readonly ResolvedHunk[] | undefined;
}

export interface ApplyResult {
  readonly applied: boolean;
  readonly outcomes: readonly FileApplyOutcome[];
  readonly error?: string | undefined;
}

/** Limits applied when validating a plan before apply/preview. */
export interface EditLimits {
  readonly maxFilesPerPlan: number;
  readonly maxHunksPerFile: number;
  /** Whole-file updates allowed only when the target has at most this many lines. */
  readonly maxWholeFileLines: number;
}

export const DEFAULT_EDIT_LIMITS: EditLimits = {
  maxFilesPerPlan: 10,
  maxHunksPerFile: 20,
  maxWholeFileLines: 200,
};
