import { describe, expect, it } from 'vitest';
import {
  asBridgeError,
  BridgeError,
  classifyHttpFailure,
  formatErrorForUser,
  isContextOverflowFailure,
  isGuardrailFailure,
} from './errors';

describe('isGuardrailFailure', () => {
  it('detects common guardrail phrasings', () => {
    expect(isGuardrailFailure('guardrail triggered')).toBe(true);
    expect(isGuardrailFailure('Request refused by safety policy')).toBe(true);
    expect(isGuardrailFailure('blocked content')).toBe(false);
    expect(isGuardrailFailure('blocked the prompt')).toBe(true);
  });

  it('does not mistake infrastructure errors for safety rejections', () => {
    expect(isGuardrailFailure('connection refused')).toBe(false);
    expect(isGuardrailFailure('ECONNREFUSED 127.0.0.1:9999')).toBe(false);
    expect(isGuardrailFailure('upstream refused the connection')).toBe(false);
  });
});

describe('isContextOverflowFailure', () => {
  it('detects overflow markers', () => {
    expect(isContextOverflowFailure('context_length_exceeded')).toBe(true);
    expect(isContextOverflowFailure('maximum context length')).toBe(true);
    expect(isContextOverflowFailure('token limit exceeded')).toBe(true);
    expect(isContextOverflowFailure('connection refused')).toBe(false);
  });
});

describe('classifyHttpFailure', () => {
  it('maps guardrail-like bodies to GUARDRAIL', () => {
    const err = classifyHttpFailure(400, 'guardrail blocked this prompt');
    expect(err).toBeInstanceOf(BridgeError);
    expect(err.code).toBe('GUARDRAIL');
    expect(err.actionable).toBeTruthy();
  });

  it('maps overflow bodies to CONTEXT_OVERFLOW', () => {
    const err = classifyHttpFailure(400, 'context_length_exceeded');
    expect(err.code).toBe('CONTEXT_OVERFLOW');
  });

  it('maps 5xx to HTTP_ERROR with actionable copy', () => {
    const err = classifyHttpFailure(503, 'internal server error');
    expect(err.code).toBe('HTTP_ERROR');
    expect(err.status).toBe(503);
    expect(err.actionable).toMatch(/Apple Intelligence/i);
  });

  it('classifies 5xx as infrastructure even when the body sounds guardrail-ish', () => {
    const err = classifyHttpFailure(502, 'connection refused by upstream safety proxy');
    expect(err.code).toBe('HTTP_ERROR');
  });

  it('maps model-downloading 5xx bodies to MODEL_NOT_READY', () => {
    const err = classifyHttpFailure(503, 'model is still loading');
    expect(err.code).toBe('MODEL_NOT_READY');
    expect(err.actionable).toMatch(/fm available/);
  });

  it('maps 429 to RATE_LIMITED', () => {
    const err = classifyHttpFailure(429, 'too many requests');
    expect(err.code).toBe('RATE_LIMITED');
    expect(err.actionable).toMatch(/quota/i);
  });
});

describe('formatErrorForUser', () => {
  it('includes actionable guidance when present', () => {
    const err = new BridgeError('GUARDRAIL', 'Blocked.', { actionable: 'Rephrase.' });
    expect(formatErrorForUser(err)).toContain('Blocked.');
    expect(formatErrorForUser(err)).toContain('Rephrase.');
  });
});

describe('asBridgeError', () => {
  it('passes BridgeError through', () => {
    const original = new BridgeError('INTERNAL', 'x');
    expect(asBridgeError(original)).toBe(original);
  });

  it('maps AbortError to CANCELLED', () => {
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    expect(asBridgeError(abort).code).toBe('CANCELLED');
  });

  it('wraps unknown values', () => {
    expect(asBridgeError('boom').message).toBe('boom');
    expect(asBridgeError('boom').code).toBe('INTERNAL');
  });
});
