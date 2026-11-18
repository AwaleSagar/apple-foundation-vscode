import * as vscode from 'vscode';

export function readLimits() {
  const config = vscode.workspace.getConfiguration('appleFoundation.model');
  const bounded = (key: string, fallback: number, min: number, max: number) => {
    const value = config.get<number>(key);
    return typeof value === 'number' && Number.isFinite(value)
      ? Math.max(min, Math.min(max, Math.floor(value)))
      : fallback;
  };
  return {
    maxContextTokens: bounded('maxContextTokens', 0, 0, 32768) || Number.MAX_SAFE_INTEGER,
    maxOutputTokens: bounded('maxOutputTokens', 1024, 16, 8192),
  };
}

export function deviceBudget(context: number, limits = readLimits()) {
  const total = Math.min(context, Math.max(512, limits.maxContextTokens));
  const output = Math.min(limits.maxOutputTokens, total - 256);
  return { maxInputTokens: total - output, maxOutputTokens: output };
}
