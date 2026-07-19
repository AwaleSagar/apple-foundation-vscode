import { validateEditPlan } from './schema';
import type { EditHunk, EditLimits, EditPlan, FileChange } from './types';
import { DEFAULT_EDIT_LIMITS } from './types';

export type ParsePlanResult =
  | { readonly ok: true; readonly plan: EditPlan; readonly format: 'json' | 'search-replace' }
  | { readonly ok: false; readonly error: string };

/**
 * Extract an EditPlan from model output.
 * Priority: fenced/raw JSON → Aider-style SEARCH/REPLACE blocks.
 */
export function parseEditPlan(
  text: string,
  options?: {
    readonly limits?: EditLimits;
    /** Default path when SEARCH/REPLACE blocks omit a path (active file). */
    readonly defaultPath?: string;
  },
): ParsePlanResult {
  const limits = options?.limits ?? DEFAULT_EDIT_LIMITS;

  const jsonCandidate = extractJsonObject(text);
  if (jsonCandidate !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonCandidate) as unknown;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Fall through to SEARCH/REPLACE; remember JSON error if that also fails
      const sr = parseSearchReplaceBlocks(text, options?.defaultPath, limits);
      if (sr.ok) {
        return sr;
      }
      return { ok: false, error: `Invalid JSON edit plan: ${message}` };
    }
    const validated = validateEditPlan(parsed, limits);
    if (validated.ok) {
      return { ok: true, plan: validated.plan, format: 'json' };
    }
    // JSON parsed but failed schema — try SEARCH/REPLACE as fallback
    const sr = parseSearchReplaceBlocks(text, options?.defaultPath, limits);
    if (sr.ok) {
      return sr;
    }
    return { ok: false, error: validated.error };
  }

  return parseSearchReplaceBlocks(text, options?.defaultPath, limits);
}

/** Pull the most likely JSON object from model text (fenced or raw). */
export function extractJsonObject(text: string): string | undefined {
  // Prefer fenced ```json ... ```
  const fenced = /```(?:json|JSON)?\s*\n([\s\S]*?)```/g;
  let best: string | undefined;
  for (const match of text.matchAll(fenced)) {
    const body = match[1]?.trim();
    if (body?.startsWith('{')) {
      best = body;
    }
  }
  if (best !== undefined) {
    return best;
  }

  // Raw first top-level object by brace matching
  const start = text.indexOf('{');
  if (start === -1) {
    return undefined;
  }
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }
  return undefined;
}

/**
 * Parse Aider-style blocks:
 *
 * path/to/file.ts
 * ```
 * <<<<<<< SEARCH
 * old
 * =======
 * new
 * >>>>>>> REPLACE
 * ```
 *
 * Also accepts path inside the fence (diff-fenced style).
 */
export function parseSearchReplaceBlocks(
  text: string,
  defaultPath: string | undefined,
  limits: EditLimits = DEFAULT_EDIT_LIMITS,
): ParsePlanResult {
  // Normalize fence variants
  const blockRe =
    /(?:^|\n)(?:([^\n`]+?)\n)?```[^\n]*\n(?:([^\n]+)\n)?<<<<<<< SEARCH\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> REPLACE\n?```/g;

  type Acc = { path: string; hunks: EditHunk[] };
  const byPath = new Map<string, Acc>();

  let found = 0;
  for (const match of text.matchAll(blockRe)) {
    found += 1;
    const pathOutside = match[1]?.trim();
    const pathInside = match[2]?.trim();
    const search = match[3] ?? '';
    const replace = match[4] ?? '';

    // pathInside might be a real path or the first line of SEARCH if model omitted path-in-fence
    let path = pathOutside ?? '';
    let searchBody = search;
    if (
      path === '' &&
      pathInside !== undefined &&
      pathInside !== '' &&
      !pathInside.startsWith('<<<<<<<')
    ) {
      // Heuristic: if pathInside looks like a path (has extension or slash), use it
      if (looksLikePath(pathInside)) {
        path = pathInside;
      } else {
        searchBody = `${pathInside}\n${search}`;
      }
    }
    if (path === '') {
      path = defaultPath ?? '';
    }
    if (path === '') {
      return {
        ok: false,
        error: 'SEARCH/REPLACE block missing file path and no default path provided',
      };
    }
    if (searchBody === '') {
      return { ok: false, error: `Empty SEARCH block for ${path}` };
    }

    let acc = byPath.get(path);
    if (acc === undefined) {
      acc = { path, hunks: [] };
      byPath.set(path, acc);
    }
    if (acc.hunks.length >= limits.maxHunksPerFile) {
      return {
        ok: false,
        error: `Too many hunks for ${path} (max ${limits.maxHunksPerFile})`,
      };
    }
    acc.hunks.push({ search: searchBody, replace });
  }

  // Simpler unfenced form:
  // path
  // <<<<<<< SEARCH
  // ...
  // =======
  // ...
  // >>>>>>> REPLACE
  if (found === 0) {
    const unfencedRe =
      /(?:^|\n)([^\n]+)\n<<<<<<< SEARCH\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> REPLACE/g;
    for (const match of text.matchAll(unfencedRe)) {
      const preceding = match[1]?.trim() ?? '';
      const search = match[2] ?? '';
      const replace = match[3] ?? '';
      // The preceding line can be anything (e.g. "I'll update the handler
      // below:"); only treat it as a path when it actually looks like one,
      // otherwise fall back to defaultPath. Skipping a stray prose line is
      // safer than sandbox-checking a sentence as a file path.
      let path = '';
      if (preceding !== '' && !preceding.startsWith('```') && looksLikePath(preceding)) {
        path = preceding;
      } else if (defaultPath !== undefined && defaultPath !== '') {
        path = defaultPath;
      } else {
        continue;
      }
      if (search === '') {
        return { ok: false, error: `Empty SEARCH block for ${path}` };
      }
      let acc = byPath.get(path);
      if (acc === undefined) {
        acc = { path, hunks: [] };
        byPath.set(path, acc);
      }
      if (acc.hunks.length >= limits.maxHunksPerFile) {
        return {
          ok: false,
          error: `Too many hunks for ${path} (max ${limits.maxHunksPerFile})`,
        };
      }
      acc.hunks.push({ search, replace });
      found += 1;
    }
  }

  if (byPath.size === 0) {
    return {
      ok: false,
      error:
        'Could not parse an edit plan. Expected a JSON object with {summary, changes} or SEARCH/REPLACE blocks.',
    };
  }
  if (byPath.size > limits.maxFilesPerPlan) {
    return {
      ok: false,
      error: `Parsed ${byPath.size} files (max ${limits.maxFilesPerPlan})`,
    };
  }

  const changes: FileChange[] = [...byPath.values()].map((acc) => ({
    path: acc.path,
    action: 'update' as const,
    hunks: acc.hunks,
  }));

  const plan: EditPlan = {
    summary: 'Proposed SEARCH/REPLACE edits',
    changes,
  };
  const validated = validateEditPlan(plan, limits);
  if (!validated.ok) {
    return { ok: false, error: validated.error };
  }
  return { ok: true, plan: validated.plan, format: 'search-replace' };
}

function looksLikePath(line: string): boolean {
  if (line.includes('://')) {
    return false;
  }
  if (line.includes('/') || line.includes('\\')) {
    return true;
  }
  return /\.\w{1,8}$/.test(line);
}
