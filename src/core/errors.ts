/**
 * Typed failures the user (or the chat UI) can act on. Prefer these over bare
 * Error so callers can branch without string-matching.
 *
 * Codes mirror Apple's Foundation Models error taxonomy where a wire
 * equivalent exists (guardrailViolation, exceededContextWindowSize,
 * rateLimited, assetsUnavailable — see docs/apple-fm-reference.md).
 */

export type BridgeErrorCode =
  | 'BRIDGE_UNAVAILABLE'
  | 'BRIDGE_NOT_FOUND'
  | 'BRIDGE_TIMEOUT'
  | 'CONTEXT_OVERFLOW'
  | 'GUARDRAIL'
  | 'RATE_LIMITED'
  | 'MODEL_NOT_READY'
  | 'CANCELLED'
  | 'HTTP_ERROR'
  | 'INTERNAL';

export class BridgeError extends Error {
  readonly code: BridgeErrorCode;
  readonly status?: number | undefined;
  readonly actionable?: string | undefined;

  constructor(
    code: BridgeErrorCode,
    message: string,
    options?: { status?: number; actionable?: string; cause?: unknown },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'BridgeError';
    this.code = code;
    this.status = options?.status;
    this.actionable = options?.actionable;
  }
}

const GUARDRAIL_PATTERNS: readonly RegExp[] = [
  /\bguardrail/i,
  /\bunsafe\b.*\bcontent\b/i,
  /\bcontent\b.*\b(policy|filter|moderation)\b/i,
  /\bsafety\b.*\b(reject|block|refus)/i,
  // "refused" alone is too broad ("connection refused"); require a safety word.
  /\brefus(ed|al)\b.*\b(safety|policy|guardrail|content)\b/i,
  /\bblocked\b.*\b(prompt|request)\b/i,
  /\b(prompt|request)\b.*\bblocked\b/i,
];

const MODEL_NOT_READY_PATTERNS: readonly RegExp[] = [
  /\bmodel\b.*\b(not ready|loading|downloading|unavailable)\b/i,
  /\bassets?\b.*\b(unavailable|missing|downloading)\b/i,
];

const CONTEXT_OVERFLOW_PATTERNS: readonly RegExp[] = [
  /\bcontext\b.*\b(length|window|overflow|too long|exceed)/i,
  /\b(token|prompt).*\b(limit|exceed|too (many|long|large))/i,
  /\bmaximum context\b/i,
  /\bcontext_length_exceeded\b/i,
];

/** True when a bridge/HTTP error body indicates Apple's safety layer rejected the turn. */
export function isGuardrailFailure(text: string): boolean {
  return GUARDRAIL_PATTERNS.some((re) => re.test(text));
}

/** True when the failure is a context-window overflow (or near-miss) from the bridge. */
export function isContextOverflowFailure(text: string): boolean {
  return CONTEXT_OVERFLOW_PATTERNS.some((re) => re.test(text));
}

/**
 * Map an HTTP failure from the bridge into a typed BridgeError with copy the
 * user can act on. Pure — no I/O.
 */
export function classifyHttpFailure(status: number, body: string): BridgeError {
  const detail = body.trim();
  const snippet = detail.length > 400 ? `${detail.slice(0, 400)}…` : detail;

  // 5xx is infrastructure, never a content decision — classify before any
  // body sniffing so proxy phrasing ("connection refused") cannot masquerade
  // as a guardrail rejection.
  if (status >= 500) {
    // Apple's assetsUnavailable case: the model exists but is still
    // downloading or not ready (fresh install, Apple Intelligence just
    // enabled). Distinct copy because waiting — not reconfiguring — fixes it.
    if (MODEL_NOT_READY_PATTERNS.some((re) => re.test(detail))) {
      return new BridgeError('MODEL_NOT_READY', 'The on-device model is not ready yet.', {
        status,
        actionable:
          'The model may still be downloading. Verify with `fm available` in a terminal, ' +
          'keep the Mac on power, and retry in a few minutes.',
      });
    }
    return new BridgeError(
      'HTTP_ERROR',
      `Bridge server error (HTTP ${status})${snippet ? `: ${snippet}` : ''}.`,
      {
        status,
        actionable:
          'Check Apple Intelligence is enabled (System Settings → Apple Intelligence & Siri) and run Apple Foundation Models: Show Logs.',
      },
    );
  }

  // Apple's rateLimited / concurrentRequests cases surface as 429 from the
  // bridge (PCC quotas; a second prompt while one is streaming on a session).
  if (status === 429) {
    return new BridgeError('RATE_LIMITED', 'The model is busy or rate limited.', {
      status,
      actionable:
        'Wait for the current response to finish and retry. The on-device model has no usage ' +
        'quota; if you enabled the PCC model, its daily quota may be exhausted.',
    });
  }

  if (isGuardrailFailure(detail) || status === 422) {
    return new BridgeError('GUARDRAIL', "Apple's safety guardrails blocked this request.", {
      status,
      actionable:
        'Rephrase the prompt (avoid framing that looks like harmful intent) or try a narrower selection. ' +
        'Do not retry the exact same wording in a loop.',
    });
  }

  if (isContextOverflowFailure(detail) || status === 413) {
    return new BridgeError(
      'CONTEXT_OVERFLOW',
      'The prompt exceeds the on-device model context window.',
      {
        status,
        actionable:
          'Select less code, clear older chat turns, or lower appleFoundation.model.maxOutputTokens ' +
          'to leave more room for input.',
      },
    );
  }

  if (status === 404) {
    return new BridgeError('HTTP_ERROR', `Bridge endpoint not found (HTTP ${status}).`, {
      status,
      actionable:
        'Confirm appleFoundation.bridge.executablePath points at `fm` or `afm` and restart the bridge.',
    });
  }

  return new BridgeError(
    'HTTP_ERROR',
    `Bridge server returned HTTP ${status}${snippet ? `: ${snippet}` : ''}.`,
    { status },
  );
}

/** User-facing markdown for a BridgeError (chat participant / notifications). */
export function formatErrorForUser(error: BridgeError): string {
  const parts = [error.message];
  if (error.actionable !== undefined && error.actionable !== '') {
    parts.push('', error.actionable);
  }
  return parts.join('\n');
}

/** Coerce unknown thrown values into BridgeError when possible. */
export function asBridgeError(error: unknown): BridgeError {
  if (error instanceof BridgeError) {
    return error;
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return new BridgeError('CANCELLED', 'Request cancelled.', { cause: error });
  }
  const message = error instanceof Error ? error.message : String(error);
  if (isGuardrailFailure(message)) {
    return new BridgeError('GUARDRAIL', "Apple's safety guardrails blocked this request.", {
      actionable: 'Rephrase the prompt or try a narrower selection.',
      cause: error,
    });
  }
  if (isContextOverflowFailure(message)) {
    return new BridgeError(
      'CONTEXT_OVERFLOW',
      'The prompt exceeds the on-device model context window.',
      {
        actionable: 'Select less code or clear older chat history.',
        cause: error,
      },
    );
  }
  return new BridgeError('INTERNAL', message, { cause: error });
}
