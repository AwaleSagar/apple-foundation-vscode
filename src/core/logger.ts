import * as vscode from 'vscode';

/**
 * Narrow logging surface so non-UI modules do not depend on the full
 * OutputChannel API and stay trivially mockable in unit tests.
 */
export type Logger = Pick<vscode.LogOutputChannel, 'trace' | 'debug' | 'info' | 'warn' | 'error'>;

export function createOutputChannel(): vscode.LogOutputChannel {
  return vscode.window.createOutputChannel('Apple Foundation Models', { log: true });
}
