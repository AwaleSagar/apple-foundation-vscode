import { alignReplaceIndent } from './indent';
import { findHunk } from './match';
import type { EditPlan, FileApplyOutcome, FileChange, ResolvedHunk } from './types';

export interface FileContentSource {
  /** Return current text for a workspace path, or undefined if missing. */
  read(path: string): string | undefined;
  exists(path: string): boolean;
}

/**
 * Resolve an EditPlan against live file contents without applying.
 * Pure: used by preview and by apply after loading buffers.
 */
export function resolveEditPlan(
  plan: EditPlan,
  source: FileContentSource,
  options?: { readonly allowFuzzy?: boolean },
): { readonly outcomes: FileApplyOutcome[]; readonly allOk: boolean } {
  const outcomes: FileApplyOutcome[] = [];
  let allOk = true;

  for (const change of plan.changes) {
    const outcome = resolveFileChange(change, source, options);
    outcomes.push(outcome);
    if (!outcome.ok) {
      allOk = false;
    }
  }

  return { outcomes, allOk };
}

/**
 * Apply resolved hunks to a string (for preview content generation).
 * Hunks must be applied from end to start so earlier offsets stay valid.
 */
export function applyResolvedHunksToText(original: string, hunks: readonly ResolvedHunk[]): string {
  const ordered = [...hunks].sort((a, b) => b.start - a.start);
  let text = original;
  for (const hunk of ordered) {
    text = text.slice(0, hunk.start) + hunk.replace + text.slice(hunk.end);
  }
  return text;
}

function resolveFileChange(
  change: FileChange,
  source: FileContentSource,
  options?: { readonly allowFuzzy?: boolean },
): FileApplyOutcome {
  if (change.action === 'delete') {
    if (!source.exists(change.path)) {
      return {
        path: change.path,
        action: change.action,
        ok: false,
        message: 'File does not exist',
      };
    }
    return { path: change.path, action: change.action, ok: true };
  }

  if (change.action === 'create') {
    if (source.exists(change.path)) {
      return {
        path: change.path,
        action: change.action,
        ok: false,
        message: 'File already exists (create refuses overwrite)',
      };
    }
    if (change.wholeFile === undefined) {
      return {
        path: change.path,
        action: change.action,
        ok: false,
        message: 'create requires wholeFile',
      };
    }
    return { path: change.path, action: change.action, ok: true };
  }

  // update
  const content = source.read(change.path);
  if (content === undefined) {
    return {
      path: change.path,
      action: change.action,
      ok: false,
      message: 'File not found',
    };
  }

  if (change.wholeFile !== undefined && (change.hunks === undefined || change.hunks.length === 0)) {
    return {
      path: change.path,
      action: change.action,
      ok: true,
      hunksApplied: 0,
      resolved: [
        {
          search: content,
          replace: change.wholeFile,
          start: 0,
          end: content.length,
          strategy: 'exact',
        },
      ],
    };
  }

  const hunks = change.hunks ?? [];
  const resolved: ResolvedHunk[] = [];
  // Match against original content only (non-overlapping assumed).
  // Track occupied ranges to detect overlaps.
  const occupied: Array<{ start: number; end: number }> = [];

  for (const hunk of hunks) {
    const matchOptions =
      options?.allowFuzzy === undefined ? undefined : { allowFuzzy: options.allowFuzzy };
    const match = findHunk(content, hunk.search, matchOptions);
    if (!match.ok) {
      return {
        path: change.path,
        action: change.action,
        ok: false,
        message:
          match.reason +
          (match.nearestSnippet !== undefined ? `\nNear:\n${match.nearestSnippet}` : ''),
        hunksApplied: resolved.length,
        resolved,
      };
    }

    for (const range of occupied) {
      if (!(match.end <= range.start || match.start >= range.end)) {
        return {
          path: change.path,
          action: change.action,
          ok: false,
          message: 'Overlapping SEARCH hunks',
          hunksApplied: resolved.length,
          resolved,
        };
      }
    }
    occupied.push({ start: match.start, end: match.end });

    // Rebase the replace on the bytes actually occupying the matched range in
    // the file. For non-exact strategies (ws/eol/fuzzy) the file's leading
    // whitespace at [match.start, match.end) can differ from hunk.search, and
    // rebasing on hunk.search would emit the model's written indent instead of
    // the file's.
    const matchedText = content.slice(match.start, match.end);
    const replace = alignReplaceIndent(matchedText, hunk.replace);
    resolved.push({
      search: hunk.search,
      replace,
      start: match.start,
      end: match.end,
      strategy: match.strategy,
    });
  }

  return {
    path: change.path,
    action: change.action,
    ok: true,
    hunksApplied: resolved.length,
    resolved,
  };
}
