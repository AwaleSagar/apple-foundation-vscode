import { accessSync, constants as fsConstants } from 'node:fs';
import { delimiter, isAbsolute } from 'node:path';
import type { HostInfo } from './availability';
import { checkHost } from './availability';

export const ONBOARDING_STATE_KEY = 'appleFoundation.onboarding.dismissed';

export type OnboardingIssueCode = 'UNSUPPORTED_HOST' | 'EXECUTABLE_NOT_FOUND';

export interface OnboardingIssue {
  readonly code: OnboardingIssueCode;
  readonly title: string;
  readonly detail: string;
  /** Suggested primary action label for a notification button. */
  readonly actionLabel?: string | undefined;
  /** Command id to run for the primary action, if any. */
  readonly actionCommand?: string | undefined;
}

/**
 * Resolve whether `executablePath` can be found as an absolute path or on PATH.
 * Pure aside from filesystem `accessSync` / PATH scan — no process spawn.
 */
export function resolveExecutableOnPath(
  executablePath: string,
  // Index access required by noPropertyAccessFromIndexSignature.
  // biome-ignore lint/complexity/useLiteralKeys: PATH is an index signature key
  envPath: string | undefined = process.env['PATH'],
): string | undefined {
  const trimmed = executablePath.trim();
  if (trimmed === '') {
    return undefined;
  }

  if (isAbsolute(trimmed) || trimmed.includes('/')) {
    try {
      accessSync(trimmed, fsConstants.X_OK);
      return trimmed;
    } catch {
      return undefined;
    }
  }

  const dirs = (envPath ?? '').split(delimiter).filter((d) => d !== '');
  for (const dir of dirs) {
    const candidate = `${dir}/${trimmed}`;
    try {
      accessSync(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // keep scanning
    }
  }
  return undefined;
}

/**
 * Compute actionable setup issues before the user hits a hard failure mid-chat.
 * Pure given injectable host info + executable resolution.
 */
export function detectOnboardingIssues(input: {
  readonly host: HostInfo;
  readonly executablePath: string;
  readonly envPath?: string | undefined;
  /** When false, skip the PATH probe (e.g. unit tests without a real fs). */
  readonly checkExecutable?: boolean | undefined;
}): OnboardingIssue[] {
  const issues: OnboardingIssue[] = [];
  const availability = checkHost(input.host);
  if (!availability.available) {
    issues.push({
      code: 'UNSUPPORTED_HOST',
      title: 'Apple Foundation Models unavailable',
      detail: availability.reason,
    });
    return issues;
  }

  const shouldCheck = input.checkExecutable !== false;
  if (shouldCheck) {
    const resolved = resolveExecutableOnPath(input.executablePath, input.envPath);
    if (resolved === undefined) {
      const isFm = input.executablePath === 'fm' || input.executablePath.endsWith('/fm');
      issues.push({
        code: 'EXECUTABLE_NOT_FOUND',
        title: 'Bridge CLI not found',
        detail: isFm
          ? `Could not find \`${input.executablePath}\` on PATH. On macOS 27+ the system \`fm\` CLI is preinstalled; on macOS 26 install the fallback with \`brew install scouzi1966/afm/afm\` and set appleFoundation.bridge.executablePath to \`afm\`.`
          : `Could not find bridge executable \`${input.executablePath}\`. Update appleFoundation.bridge.executablePath or install the bridge CLI.`,
        actionLabel: 'Open settings',
        actionCommand: 'workbench.action.openSettings',
      });
    }
  }

  return issues;
}

/** One-line markdown summary for chat when setup is incomplete. */
export function formatOnboardingMarkdown(issues: readonly OnboardingIssue[]): string {
  if (issues.length === 0) {
    return '';
  }
  const lines = ['### Apple Foundation Models setup needed', ''];
  for (const issue of issues) {
    lines.push(`- **${issue.title}** — ${issue.detail}`);
  }
  lines.push(
    '',
    'Run **Apple Foundation Models: Show Status** after fixing setup, or **Show Logs** for details.',
  );
  return lines.join('\n');
}
