import * as vscode from 'vscode';
import { resolveWireModel } from '../bridge/client';
import type { BridgeServerManager } from '../bridge/server';
import { checkHost, currentHostInfo } from '../core/availability';
import { type BridgeConfig, maxInputTokens } from '../core/config';
import { asBridgeError, formatErrorForUser } from '../core/errors';
import { prependHistory } from '../core/history';
import type { Logger } from '../core/logger';
import { fitMessagesToBudget } from '../core/tokens';
import {
  clearStagedEdit,
  DEFAULT_EDIT_LIMITS,
  openDiffForPath,
  parseEditPlan,
  preparePlan,
  resolveSandboxPath,
  stageEdit,
} from '../editing';
import { getStagedDiff } from './git';
import { historyFromChatContext } from './historyFromVscode';
import { buildMessages, type TurnContext } from './prompts';

export const PARTICIPANT_ID = 'apple-foundation.chat';

/** Gather editor selection context from the active text editor, if any. */
function activeEditorContext(): Pick<
  TurnContext,
  'selection' | 'languageId' | 'fileName' | 'filePath' | 'fileContent'
> {
  const editor = vscode.window.activeTextEditor;
  if (editor === undefined) {
    return {};
  }
  const { document, selection } = editor;
  const selected = selection.isEmpty ? undefined : document.getText(selection);
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  let filePath: string | undefined = document.uri.path.split('/').pop();
  if (workspaceFolder !== undefined) {
    filePath = vscode.workspace.asRelativePath(document.uri, false);
  }
  return {
    selection: selected,
    languageId: document.languageId,
    fileName: document.uri.path.split('/').pop(),
    filePath,
    fileContent: document.getText(),
  };
}

async function buildTurnContext(request: vscode.ChatRequest): Promise<TurnContext> {
  const editor = activeEditorContext();
  const base: TurnContext = {
    command: request.command,
    prompt: request.prompt,
    selection: editor.selection,
    languageId: editor.languageId,
    fileName: editor.fileName,
    filePath: editor.filePath,
    fileContent: request.command === 'edit' ? editor.fileContent : undefined,
  };
  if (request.command === 'commit') {
    return { ...base, diff: await getStagedDiff() };
  }
  return base;
}

interface AppleChatResult extends vscode.ChatResult {
  readonly metadata?: { readonly command?: string | undefined };
}

function suggestFollowups(command: string | undefined): vscode.ChatFollowup[] {
  if (command === 'commit') {
    return [{ prompt: '', command: 'commit', label: 'Regenerate commit message' }];
  }
  if (command === 'edit') {
    return [
      { prompt: 'Simplify the previous edit', command: 'edit', label: 'Refine edit' },
      { prompt: '', command: 'explain', label: 'Explain the selection' },
    ];
  }
  return [
    { prompt: '', command: 'explain', label: 'Explain the selection' },
    { prompt: '', command: 'doc', label: 'Document the selection' },
    { prompt: '', command: 'edit', label: 'Edit the selection' },
  ];
}

function workspaceFolderPaths(): string[] {
  return (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
}

/**
 * Register the `@apple` chat participant: streaming markdown responses backed
 * by the on-device model, with `/explain`, `/doc`, `/commit`, and `/edit`.
 */
export function registerChatParticipant(
  context: vscode.ExtensionContext,
  server: BridgeServerManager,
  logger: Logger,
  getConfig: () => BridgeConfig,
): void {
  const handler: vscode.ChatRequestHandler = async (
    request,
    chatContext,
    stream,
    token,
  ): Promise<AppleChatResult> => {
    const meta = { command: request.command };
    const availability = checkHost(currentHostInfo());
    if (!availability.available) {
      stream.markdown(availability.reason);
      return { metadata: meta };
    }

    if (request.command === 'commit') {
      const staged = await getStagedDiff();
      if (staged === undefined) {
        stream.markdown(
          'No staged changes found. Stage the changes you want summarized (`git add`) and try again.',
        );
        return { metadata: meta };
      }
    }

    if (request.command === 'edit') {
      return handleEditCommand(
        request,
        chatContext,
        stream,
        token,
        server,
        logger,
        getConfig,
        meta,
      );
    }

    const turn = await buildTurnContext(request);
    const config = getConfig();
    // Slash commands are one-shot (fresh system prompt); free-form chat reuses thread history.
    const history =
      request.command === undefined || request.command === ''
        ? historyFromChatContext(chatContext)
        : [];
    const withHistory = prependHistory(buildMessages(turn), history);
    const budgeted = fitMessagesToBudget(withHistory, maxInputTokens(config));
    if (budgeted.trimmed) {
      logger.info(
        `Trimmed @apple turn to fit context (~${budgeted.estimatedTokens} input tokens).`,
      );
      stream.markdown('_Earlier context was trimmed to fit the on-device model window._\n\n');
    }

    let client: Awaited<ReturnType<BridgeServerManager['ensureRunning']>>;
    try {
      client = await server.ensureRunning();
    } catch (error) {
      const bridgeError = asBridgeError(error);
      logger.error(`Bridge unavailable for participant: ${bridgeError.message}`);
      stream.markdown(formatErrorForUser(bridgeError));
      return { errorDetails: { message: bridgeError.message }, metadata: meta };
    }

    let wireModel: string;
    try {
      wireModel = await resolveWireModel(client, { offlineOnly: config.offlineOnlyMode });
    } catch (error) {
      const bridgeError = asBridgeError(error);
      stream.markdown(formatErrorForUser(bridgeError));
      return { errorDetails: { message: bridgeError.message }, metadata: meta };
    }
    // Hold the idle timer open for the whole stream, not just request start.
    const release = server.beginRequest();
    const abort = new AbortController();
    const cancellation = token.onCancellationRequested(() => abort.abort());

    try {
      const deltas = client.streamChat(
        {
          model: wireModel,
          messages: budgeted.messages,
          stream: true,
          max_tokens: config.maxOutputTokens,
        },
        abort.signal,
      );
      for await (const delta of deltas) {
        stream.markdown(delta);
      }
    } catch (error) {
      if (!token.isCancellationRequested) {
        const bridgeError = asBridgeError(error);
        logger.error(`Participant request failed [${bridgeError.code}]: ${bridgeError.message}`);
        stream.markdown(`\n\n${formatErrorForUser(bridgeError)}`);
        return { errorDetails: { message: bridgeError.message }, metadata: meta };
      }
    } finally {
      release();
      cancellation.dispose();
    }

    return { metadata: meta };
  };

  const participant = vscode.chat.createChatParticipant(PARTICIPANT_ID, handler);
  participant.iconPath = new vscode.ThemeIcon('sparkle');
  participant.followupProvider = {
    provideFollowups: (result: AppleChatResult, _chatContext, _token) =>
      result.errorDetails === undefined ? suggestFollowups(result.metadata?.command) : [],
  };
  context.subscriptions.push(participant);
}

async function handleEditCommand(
  request: vscode.ChatRequest,
  _chatContext: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  server: BridgeServerManager,
  logger: Logger,
  getConfig: () => BridgeConfig,
  meta: { command: string | undefined },
): Promise<AppleChatResult> {
  const config = getConfig();
  if (!config.editing.enabled) {
    stream.markdown(
      'Workspace editing is disabled. Enable `appleFoundation.editing.enabled` in settings.',
    );
    return { metadata: meta };
  }

  if (!vscode.workspace.isTrusted) {
    stream.markdown(
      'Workspace Trust is required before Apple can propose file edits. Trust this folder and try again.',
    );
    return { metadata: meta };
  }

  const turn = await buildTurnContext(request);
  if (turn.fileContent === undefined || turn.filePath === undefined) {
    stream.markdown(
      'Open a text file in the editor (optionally select a region), then run `@apple /edit` with your change request.',
    );
    return { metadata: meta };
  }

  const folders = workspaceFolderPaths();
  if (folders.length === 0) {
    stream.markdown('Open a workspace folder before using `/edit`.');
    return { metadata: meta };
  }

  const limits = {
    maxFilesPerPlan: config.editing.maxFilesPerPlan,
    maxHunksPerFile: config.editing.maxHunksPerFile,
    maxWholeFileLines: config.editing.maxWholeFileLines,
  };

  // Cap file content for the small context window: prefer selection + window around it
  let fileContent = turn.fileContent;
  const maxChars = Math.min(fileContent.length, 12_000);
  if (fileContent.length > maxChars) {
    if (turn.selection !== undefined && turn.selection.length < maxChars) {
      fileContent = turn.selection;
      stream.markdown(
        '_File is large — sending the selection only to fit the on-device window._\n\n',
      );
    } else {
      fileContent = fileContent.slice(0, maxChars);
      stream.markdown('_File is large — truncated to fit the on-device model window._\n\n');
    }
  }

  const messages = buildMessages({ ...turn, fileContent });
  const budgeted = fitMessagesToBudget(messages, maxInputTokens(config));
  if (budgeted.trimmed) {
    stream.markdown('_Edit prompt was trimmed to fit the on-device model window._\n\n');
  }

  stream.progress('Generating edit plan with Apple On-Device…');

  let client: Awaited<ReturnType<BridgeServerManager['ensureRunning']>>;
  try {
    client = await server.ensureRunning();
  } catch (error) {
    const bridgeError = asBridgeError(error);
    stream.markdown(formatErrorForUser(bridgeError));
    return { errorDetails: { message: bridgeError.message }, metadata: meta };
  }

  let wireModel: string;
  try {
    wireModel = await resolveWireModel(client, { offlineOnly: config.offlineOnlyMode });
  } catch (error) {
    const bridgeError = asBridgeError(error);
    stream.markdown(formatErrorForUser(bridgeError));
    return { errorDetails: { message: bridgeError.message }, metadata: meta };
  }

  const release = server.beginRequest();
  const abort = new AbortController();
  const cancellation = token.onCancellationRequested(() => abort.abort());
  let full = '';

  try {
    const deltas = client.streamChat(
      {
        model: wireModel,
        messages: budgeted.messages,
        stream: true,
        max_tokens: config.maxOutputTokens,
      },
      abort.signal,
    );
    for await (const delta of deltas) {
      full += delta;
    }
  } catch (error) {
    if (!token.isCancellationRequested) {
      const bridgeError = asBridgeError(error);
      logger.error(`Edit request failed [${bridgeError.code}]: ${bridgeError.message}`);
      stream.markdown(formatErrorForUser(bridgeError));
      return { errorDetails: { message: bridgeError.message }, metadata: meta };
    }
    return { metadata: meta };
  } finally {
    release();
    cancellation.dispose();
  }

  if (token.isCancellationRequested) {
    return { metadata: meta };
  }

  stream.progress('Parsing edit plan…');
  const parsed = parseEditPlan(full, {
    limits: { ...DEFAULT_EDIT_LIMITS, ...limits },
    defaultPath: turn.filePath,
  });

  if (!parsed.ok) {
    stream.markdown(
      `**Could not parse an edit plan**\n\n${parsed.error}\n\n` +
        'Try a more specific request, or select a smaller region.\n\n' +
        '<details><summary>Model output</summary>\n\n```\n' +
        full.slice(0, 2000) +
        '\n```\n</details>',
    );
    return { errorDetails: { message: parsed.error }, metadata: meta };
  }

  // Sandbox every path
  const absoluteByRelative = new Map<string, string>();
  for (const change of parsed.plan.changes) {
    const checked = resolveSandboxPath(change.path, {
      workspaceFolders: folders,
      deniedGlobs: config.editing.deniedGlobs,
    });
    if (!checked.ok) {
      stream.markdown(`**Path denied:** \`${change.path}\` — ${checked.reason}`);
      return { errorDetails: { message: checked.reason }, metadata: meta };
    }
    absoluteByRelative.set(change.path, checked.absolutePath);
    // Also key by relative from sandbox for preparePlan
    absoluteByRelative.set(checked.relativePath, checked.absolutePath);
  }

  stream.progress('Matching SEARCH blocks against the workspace…');
  const prepared = await preparePlan(parsed.plan, absoluteByRelative, {
    allowFuzzy: config.editing.allowFuzzyMatch,
  });

  if (!prepared.allOk) {
    const failures = prepared.outcomes
      .filter((o) => !o.ok)
      .map((o) => `- \`${o.path}\`: ${o.message ?? 'failed'}`)
      .join('\n');
    stream.markdown(
      `**Could not match the proposed edits to the current files**\n\n${failures}\n\n` +
        'The model may have drifted from the file. Re-run `/edit` or tighten the selection.',
    );
    // Still show raw plan for transparency
    stream.markdown(`\n\n**Summary:** ${parsed.plan.summary}\n`);
    return { errorDetails: { message: 'Edit match failed' }, metadata: meta };
  }

  clearStagedEdit();
  const staged = stageEdit({
    plan: parsed.plan,
    outcomes: prepared.outcomes,
    previewByAbsolutePath: prepared.previewByAbsolutePath,
    originalByAbsolutePath: prepared.originalByAbsolutePath,
    absoluteByRelative,
  });

  stream.markdown(`### Edit plan ready\n\n**${staged.plan.summary}**\n\n`);
  for (const outcome of staged.outcomes) {
    const abs = absoluteByRelative.get(outcome.path);
    const strategies = outcome.resolved?.map((h) => h.strategy).join(', ') ?? outcome.action;
    stream.markdown(`- \`${outcome.path}\` (${outcome.action}, ${strategies})\n`);
    if (abs !== undefined) {
      stream.reference(vscode.Uri.file(abs));
    }
  }

  // File tree for multi-file awareness
  const tree: vscode.ChatResponseFileTree[] = staged.plan.changes.map((c) => ({
    name: c.path,
  }));
  const baseFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (baseFolder !== undefined && tree.length > 0) {
    stream.filetree(tree, baseFolder);
  }

  stream.markdown(
    '\nReview the diff, then **Apply** to write changes (native Undo is available afterwards).\n',
  );

  stream.button({
    command: 'appleFoundation.editing.reviewDiff',
    title: 'Review Diff',
  });
  stream.button({
    command: 'appleFoundation.editing.applyPlan',
    title: 'Apply Edit',
  });
  stream.button({
    command: 'appleFoundation.editing.rejectPlan',
    title: 'Reject',
  });

  // Auto-open first diff for single-file MVP UX
  const firstAbs = [...prepared.previewByAbsolutePath.keys()][0];
  if (firstAbs !== undefined) {
    try {
      await openDiffForPath(firstAbs, staged.plan.summary);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`Could not open diff preview: ${message}`);
    }
  }

  return { metadata: meta };
}
