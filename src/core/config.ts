import * as vscode from 'vscode';

export const CONFIG_SECTION = 'appleFoundation';

export interface BridgeConfig {
  /** Path or name of the bridge executable (fm/afm); resolved against PATH when not absolute. */
  readonly executablePath: string;
  /** Loopback port the bridge server listens on. */
  readonly port: number;
  /** Start the bridge automatically when a chat request needs it. */
  readonly autoStart: boolean;
  /** Cap on tokens generated per response. */
  readonly maxOutputTokens: number;
}

export const DEFAULT_BRIDGE_CONFIG: BridgeConfig = {
  executablePath: 'fm',
  port: 9999,
  autoStart: true,
  maxOutputTokens: 1024,
};

const MIN_PORT = 1024;
const MAX_PORT = 65535;
const MIN_OUTPUT_TOKENS = 16;
const MAX_OUTPUT_TOKENS = 4096;

type RawBridgeConfig = { [K in keyof BridgeConfig]?: BridgeConfig[K] | undefined };

/** Pure normalization so invalid user settings degrade to safe defaults. */
export function normalizeBridgeConfig(raw: RawBridgeConfig): BridgeConfig {
  const executablePath =
    typeof raw.executablePath === 'string' && raw.executablePath.trim() !== ''
      ? raw.executablePath.trim()
      : DEFAULT_BRIDGE_CONFIG.executablePath;

  const port =
    typeof raw.port === 'number' && Number.isInteger(raw.port)
      ? Math.min(MAX_PORT, Math.max(MIN_PORT, raw.port))
      : DEFAULT_BRIDGE_CONFIG.port;

  const autoStart =
    typeof raw.autoStart === 'boolean' ? raw.autoStart : DEFAULT_BRIDGE_CONFIG.autoStart;

  const maxOutputTokens =
    typeof raw.maxOutputTokens === 'number' && Number.isFinite(raw.maxOutputTokens)
      ? Math.min(MAX_OUTPUT_TOKENS, Math.max(MIN_OUTPUT_TOKENS, Math.floor(raw.maxOutputTokens)))
      : DEFAULT_BRIDGE_CONFIG.maxOutputTokens;

  return { executablePath, port, autoStart, maxOutputTokens };
}

export function readBridgeConfig(): BridgeConfig {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  return normalizeBridgeConfig({
    executablePath: cfg.get<string>('bridge.executablePath'),
    port: cfg.get<number>('bridge.port'),
    autoStart: cfg.get<boolean>('bridge.autoStart'),
    maxOutputTokens: cfg.get<number>('model.maxOutputTokens'),
  });
}
