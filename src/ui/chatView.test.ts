import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  Uri: {
    joinPath: (base: { path: string }, ...segments: string[]) => ({
      path: [base.path, ...segments].join('/'),
      toString: () => `file://${[base.path, ...segments].join('/')}`,
    }),
  },
}));

import type * as vscode from 'vscode';
import { chatView } from './chatView';

function makeWebview() {
  const webview = {
    cspSource: 'vscode-webview://test-source',
    options: {} as vscode.WebviewOptions,
    asWebviewUri: (uri: { path: string }) =>
      `https://test.vscode-cdn.net${uri.path}` as unknown as vscode.Uri,
  };
  return webview as unknown as vscode.Webview;
}

describe('chatView', () => {
  it('sets a strict CSP including base-uri none and form-action none', () => {
    const webview = makeWebview();
    const root = { path: '/ext' } as unknown as vscode.Uri;
    const html = chatView(webview, root);

    const cspMatch = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/);
    expect(cspMatch).not.toBeNull();
    const csp = cspMatch?.[1] ?? '';

    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("form-action 'none'");
    expect(csp).toContain('img-src vscode-webview://test-source');
    expect(csp).toContain('style-src vscode-webview://test-source');
    expect(csp).toMatch(/script-src 'nonce-[A-Za-z0-9+/=]+'/);
  });

  it('uses a fresh nonce per render and avoids inline handlers or styles', () => {
    const webview = makeWebview();
    const root = { path: '/ext' } as unknown as vscode.Uri;
    const first = chatView(webview, root);
    const second = chatView(webview, root);

    const firstNonce = first.match(/nonce="([^"]+)"/)?.[1];
    const secondNonce = second.match(/nonce="([^"]+)"/)?.[1];
    expect(firstNonce).toBeTruthy();
    expect(secondNonce).toBeTruthy();
    expect(firstNonce).not.toBe(secondNonce);

    expect(first).not.toMatch(/\son[a-z]+=/i);
    expect(first).not.toMatch(/\sstyle=/i);
    expect(first).toContain('data-action="commit" disabled');
  });
});
