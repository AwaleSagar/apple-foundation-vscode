import {
  DEFAULT_EDIT_LIMITS,
  type EditHunk,
  type EditLimits,
  type EditPlan,
  type FileChange,
  type FileChangeAction,
} from './types';

export type ValidatePlanResult =
  | { readonly ok: true; readonly plan: EditPlan }
  | { readonly ok: false; readonly error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** Index-signature-safe property read (TS noPropertyAccessFromIndexSignature). */
function prop(raw: Record<string, unknown>, key: string): unknown {
  return raw[key];
}

function parseAction(value: unknown): FileChangeAction | undefined {
  if (value === 'update' || value === 'create' || value === 'delete') {
    return value;
  }
  return undefined;
}

function parseHunk(raw: unknown, index: number): EditHunk | string {
  if (!isRecord(raw)) {
    return `hunks[${index}] must be an object`;
  }
  const search = asString(prop(raw, 'search'));
  const replace = asString(prop(raw, 'replace'));
  if (search === undefined) {
    return `hunks[${index}].search is required`;
  }
  if (replace === undefined) {
    return `hunks[${index}].replace is required (use "" to delete)`;
  }
  if (search === '') {
    return `hunks[${index}].search must not be empty`;
  }
  const anchorHint = asString(prop(raw, 'anchorHint'));
  return {
    search,
    replace,
    ...(anchorHint !== undefined ? { anchorHint } : {}),
  };
}

function parseFileChange(raw: unknown, index: number, limits: EditLimits): FileChange | string {
  if (!isRecord(raw)) {
    return `changes[${index}] must be an object`;
  }
  const path = asString(prop(raw, 'path'))?.trim();
  if (path === undefined || path === '') {
    return `changes[${index}].path is required`;
  }
  const action = parseAction(prop(raw, 'action'));
  if (action === undefined) {
    return `changes[${index}].action must be update | create | delete`;
  }

  const languageId = asString(prop(raw, 'languageId'));
  const wholeFile = asString(prop(raw, 'wholeFile'));
  const rawHunks = prop(raw, 'hunks');

  let hunks: EditHunk[] | undefined;
  if (rawHunks !== undefined) {
    if (!Array.isArray(rawHunks)) {
      return `changes[${index}].hunks must be an array`;
    }
    if (rawHunks.length > limits.maxHunksPerFile) {
      return `changes[${index}] has ${rawHunks.length} hunks (max ${limits.maxHunksPerFile})`;
    }
    hunks = [];
    for (let i = 0; i < rawHunks.length; i++) {
      const parsed = parseHunk(rawHunks[i], i);
      if (typeof parsed === 'string') {
        return `changes[${index}].${parsed}`;
      }
      hunks.push(parsed);
    }
  }

  if (action === 'update') {
    if ((hunks === undefined || hunks.length === 0) && wholeFile === undefined) {
      return `changes[${index}] update requires hunks or wholeFile`;
    }
  }
  if (action === 'create') {
    if (wholeFile === undefined) {
      return `changes[${index}] create requires wholeFile`;
    }
  }

  return {
    path,
    action,
    ...(languageId !== undefined ? { languageId } : {}),
    ...(hunks !== undefined ? { hunks } : {}),
    ...(wholeFile !== undefined ? { wholeFile } : {}),
  };
}

/**
 * Validate unknown JSON into a typed EditPlan. Pure — no VS Code dependency.
 */
export function validateEditPlan(
  value: unknown,
  limits: EditLimits = DEFAULT_EDIT_LIMITS,
): ValidatePlanResult {
  if (!isRecord(value)) {
    return { ok: false, error: 'Edit plan must be a JSON object' };
  }

  const summary = asString(prop(value, 'summary'))?.trim() ?? '';
  const rawChanges = prop(value, 'changes');
  if (!Array.isArray(rawChanges)) {
    return { ok: false, error: 'Edit plan.changes must be an array' };
  }
  if (rawChanges.length === 0) {
    return { ok: false, error: 'Edit plan.changes must not be empty' };
  }
  if (rawChanges.length > limits.maxFilesPerPlan) {
    return {
      ok: false,
      error: `Edit plan has ${rawChanges.length} files (max ${limits.maxFilesPerPlan})`,
    };
  }

  const changes: FileChange[] = [];
  for (let i = 0; i < rawChanges.length; i++) {
    const parsed = parseFileChange(rawChanges[i], i, limits);
    if (typeof parsed === 'string') {
      return { ok: false, error: parsed };
    }
    changes.push(parsed);
  }

  return {
    ok: true,
    plan: {
      summary: summary === '' ? 'Proposed edits' : summary,
      changes,
    },
  };
}
