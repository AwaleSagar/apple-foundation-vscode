import * as vscode from 'vscode';
import type { BridgeServerManager } from '../bridge/server';
import { checkHost, currentHostInfo } from '../core/availability';

const POLL_INTERVAL_MS = 60_000;

/**
 * Status bar entry showing bridge health at a glance; clicking opens the
 * management quick-pick. Polling is cheap (cached loopback probe, never
 * spawns) and only runs on supported hosts.
 */
export function registerStatusBar(
  context: vscode.ExtensionContext,
  server: BridgeServerManager,
): void {
  if (!checkHost(currentHostInfo()).available) {
    return;
  }

  const item = vscode.window.createStatusBarItem(
    'appleFoundation.status',
    vscode.StatusBarAlignment.Right,
    100,
  );
  item.name = 'Apple Foundation Models';
  item.command = 'appleFoundation.manage';
  item.text = '$(sparkle) Apple FM';
  item.tooltip = 'Apple Foundation Models — checking bridge…';
  item.show();
  context.subscriptions.push(item);

  let disposed = false;
  const refresh = async (): Promise<void> => {
    const healthy = await server.checkHealth();
    if (disposed) {
      return;
    }
    if (healthy) {
      item.text = '$(sparkle) Apple FM';
      item.tooltip = 'Apple Foundation Models — bridge healthy · on-device · private';
    } else {
      item.text = '$(sparkle) Apple FM $(debug-disconnect)';
      item.tooltip =
        'Apple Foundation Models — bridge not running (it starts automatically on first chat)';
    }
  };

  void refresh();
  const timer = setInterval(() => {
    void refresh();
  }, POLL_INTERVAL_MS);
  timer.unref?.();
  context.subscriptions.push({
    dispose: () => {
      disposed = true;
      clearInterval(timer);
    },
  });
}
