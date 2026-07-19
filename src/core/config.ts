import * as vscode from 'vscode';
import { DEFAULT_CONTEXT_WINDOW_TOKENS } from './tokens';

export const CONFIG_SECTION = 'appleFoundation';

export interface EditingConfig {
  /** Master switch for AI-assisted workspace edits. */
  readonly enabled: boolean;
  /** Always require an explicit Apply before mutating files. */
  readonly requireConfirmation: boolean;
  readonly maxFilesPerPlan: number;
  readonly maxHunksPerFile: number;
  /** Whole-file updates only when the target has at most this many lines. */
  readonly maxWholeFileLines: number;
  /** Allow fuzzy SEARCH matching when exact strategies fail. */
  readonly allowFuzzyMatch: boolean;
  /** Glob patterns that editing tools must never touch. */
  readonly deniedGlobs: readonly string[];
}

export interface BridgeConfig {
  /** Path or name of the bridge executable (fm/afm); resolved against PATH when not absolute. */
  readonly executablePath: string;
  /** Loopback port the bridge server listens on. */
  readonly port: number;
  /** Start the bridge automatically when a chat request needs it. */
  readonly autoStart: boolean;
  /** Cap on tokens generated per response. */
  readonly maxOutputTokens: number;
  /**
   * Shared context window (input + output) assumed for budgeting. Prefer
   * runtime discovery when the bridge exposes it; until then this is the knob.
   */
  readonly maxContextTokens: number;
  /**
   * Minutes of idle time before a bridge process we spawned is stopped.
   * `0` disables idle shutdown. External (user-started) servers are never killed.
   */
  readonly idleTimeoutMinutes: number;
  /**
   * When true, refuse to use any model other than the on-device `system`
   * model — even if the bridge offers alternatives (e.g. Private Cloud
   * Compute). Auditable guarantee for air-gapped environments.
   */
  readonly offlineOnlyMode: boolean;
  readonly editing: EditingConfig;
}

export const DEFAULT_EDITING_CONFIG: EditingConfig = {
  enabled: true,
  requireConfirmation: true,
  maxFilesPerPlan: 10,
  maxHunksPerFile: 20,
  maxWholeFileLines: 200,
  allowFuzzyMatch: true,
  deniedGlobs: ['**/.env*', '**/.env', '**/secrets/**', '**/*.pem', '**/*.key'],
};

export const DEFAULT_BRIDGE_CONFIG: BridgeConfig = {
  executablePath: 'fm',
  port: 9999,
  autoStart: true,
  maxOutputTokens: 1024,
  maxContextTokens: DEFAULT_CONTEXT_WINDOW_TOKENS,
  idleTimeoutMinutes: 5,
  offlineOnlyMode: false,
  editing: DEFAULT_EDITING_CONFIG,
};

const MIN_PORT = 1024;
const MAX_PORT = 65535;
const MIN_OUTPUT_TOKENS = 16;
const MAX_OUTPUT_TOKENS = 8192;
const MIN_CONTEXT_TOKENS = 512;
const MAX_CONTEXT_TOKENS = 32_768;
const MAX_IDLE_MINUTES = 120;

type RawBridgeConfig = {
  [K in keyof Omit<BridgeConfig, 'editing'>]?: BridgeConfig[K] | undefined;
} & {
  editing?: Partial<EditingConfig> | undefined;
};

function normalizeEditingConfig(raw: Partial<EditingConfig> | undefined): EditingConfig {
  const base = DEFAULT_EDITING_CONFIG;
  if (raw === undefined) {
    return base;
  }
  const maxFilesPerPlan =
    typeof raw.maxFilesPerPlan === 'number' && Number.isFinite(raw.maxFilesPerPlan)
      ? Math.min(50, Math.max(1, Math.floor(raw.maxFilesPerPlan)))
      : base.maxFilesPerPlan;
  const maxHunksPerFile =
    typeof raw.maxHunksPerFile === 'number' && Number.isFinite(raw.maxHunksPerFile)
      ? Math.min(100, Math.max(1, Math.floor(raw.maxHunksPerFile)))
      : base.maxHunksPerFile;
  const maxWholeFileLines =
    typeof raw.maxWholeFileLines === 'number' && Number.isFinite(raw.maxWholeFileLines)
      ? Math.min(2000, Math.max(20, Math.floor(raw.maxWholeFileLines)))
      : base.maxWholeFileLines;
  const deniedGlobs = Array.isArray(raw.deniedGlobs)
    ? raw.deniedGlobs.filter((g): g is string => typeof g === 'string' && g.trim() !== '')
    : base.deniedGlobs;

  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : base.enabled,
    requireConfirmation:
      typeof raw.requireConfirmation === 'boolean'
        ? raw.requireConfirmation
        : base.requireConfirmation,
    maxFilesPerPlan,
    maxHunksPerFile,
    maxWholeFileLines,
    allowFuzzyMatch:
      typeof raw.allowFuzzyMatch === 'boolean' ? raw.allowFuzzyMatch : base.allowFuzzyMatch,
    deniedGlobs: deniedGlobs.length > 0 ? deniedGlobs : base.deniedGlobs,
  };
}

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

  let maxOutputTokens =
    typeof raw.maxOutputTokens === 'number' && Number.isFinite(raw.maxOutputTokens)
      ? Math.min(MAX_OUTPUT_TOKENS, Math.max(MIN_OUTPUT_TOKENS, Math.floor(raw.maxOutputTokens)))
      : DEFAULT_BRIDGE_CONFIG.maxOutputTokens;

  const maxContextTokens =
    typeof raw.maxContextTokens === 'number' && Number.isFinite(raw.maxContextTokens)
      ? Math.min(MAX_CONTEXT_TOKENS, Math.max(MIN_CONTEXT_TOKENS, Math.floor(raw.maxContextTokens)))
      : DEFAULT_BRIDGE_CONFIG.maxContextTokens;

  // Keep at least 256 tokens of input headroom. The context window reflects
  // what the device supports, so a conflicting output cap is lowered — the
  // window is never silently inflated past the hardware.
  if (maxContextTokens - maxOutputTokens < 256) {
    maxOutputTokens = Math.max(MIN_OUTPUT_TOKENS, maxContextTokens - 256);
  }

  const idleTimeoutMinutes =
    typeof raw.idleTimeoutMinutes === 'number' && Number.isFinite(raw.idleTimeoutMinutes)
      ? Math.min(MAX_IDLE_MINUTES, Math.max(0, Math.floor(raw.idleTimeoutMinutes)))
      : DEFAULT_BRIDGE_CONFIG.idleTimeoutMinutes;

  const offlineOnlyMode =
    typeof raw.offlineOnlyMode === 'boolean'
      ? raw.offlineOnlyMode
      : DEFAULT_BRIDGE_CONFIG.offlineOnlyMode;

  return {
    executablePath,
    port,
    autoStart,
    maxOutputTokens,
    maxContextTokens,
    idleTimeoutMinutes,
    offlineOnlyMode,
    editing: normalizeEditingConfig(raw.editing),
  };
}

/**
 * Budgeting uses the ~4-chars/token estimator, which undercounts Apple's real
 * tokenizer on code-heavy text (verified against `fm token-count`). This
 * factor reserves headroom for that error so near-window prompts do not slip
 * past the budget and overflow at the bridge.
 */
const ESTIMATE_SAFETY_FACTOR = 0.75;

/** Maximum tokens available for input given a normalized config. */
export function maxInputTokens(config: BridgeConfig): number {
  const headroom = config.maxContextTokens - config.maxOutputTokens;
  return Math.max(256, Math.floor(headroom * ESTIMATE_SAFETY_FACTOR));
}

export function readBridgeConfig(): BridgeConfig {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  // Build a mutable bag then pass as Partial — exactOptionalPropertyTypes forbids
  // assigning `T | undefined` into optional props, so only set defined values.
  const editingBag: {
    enabled?: boolean;
    requireConfirmation?: boolean;
    maxFilesPerPlan?: number;
    maxHunksPerFile?: number;
    maxWholeFileLines?: number;
    allowFuzzyMatch?: boolean;
    deniedGlobs?: string[];
  } = {};
  const enabled = cfg.get<boolean>('editing.enabled');
  if (enabled !== undefined) {
    editingBag.enabled = enabled;
  }
  const requireConfirmation = cfg.get<boolean>('editing.requireConfirmation');
  if (requireConfirmation !== undefined) {
    editingBag.requireConfirmation = requireConfirmation;
  }
  const maxFilesPerPlan = cfg.get<number>('editing.maxFilesPerPlan');
  if (maxFilesPerPlan !== undefined) {
    editingBag.maxFilesPerPlan = maxFilesPerPlan;
  }
  const maxHunksPerFile = cfg.get<number>('editing.maxHunksPerFile');
  if (maxHunksPerFile !== undefined) {
    editingBag.maxHunksPerFile = maxHunksPerFile;
  }
  const maxWholeFileLines = cfg.get<number>('editing.maxWholeFileLines');
  if (maxWholeFileLines !== undefined) {
    editingBag.maxWholeFileLines = maxWholeFileLines;
  }
  const allowFuzzyMatch = cfg.get<boolean>('editing.allowFuzzyMatch');
  if (allowFuzzyMatch !== undefined) {
    editingBag.allowFuzzyMatch = allowFuzzyMatch;
  }
  const deniedGlobs = cfg.get<string[]>('editing.deniedGlobs');
  if (deniedGlobs !== undefined) {
    editingBag.deniedGlobs = deniedGlobs;
  }

  return normalizeBridgeConfig({
    executablePath: cfg.get<string>('bridge.executablePath'),
    port: cfg.get<number>('bridge.port'),
    autoStart: cfg.get<boolean>('bridge.autoStart'),
    maxOutputTokens: cfg.get<number>('model.maxOutputTokens'),
    maxContextTokens: cfg.get<number>('model.maxContextTokens'),
    idleTimeoutMinutes: cfg.get<number>('bridge.idleTimeoutMinutes'),
    offlineOnlyMode: cfg.get<boolean>('offlineOnlyMode'),
    editing: editingBag,
  });
}
