import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';

const paths = {
  code: 'm5.5 4-4 4 4 4m5-8 4 4-4 4',
  note: 'M3 1.5h7l3 3V14.5H3z M9.5 1.5V5H13 M5.5 8h5m-5 3h4',
  commit: 'M1 8h4m6 0h4 M11 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  device: 'M2.5 2.5h11v8h-11z M1 13h14',
  send: 'M8 13.5v-11m-5 5 5-5 5 5',
  stop: 'M3.5 3.5h9v9h-9z',
};

function icon(name: keyof typeof paths) {
  return `<svg class="icon" viewBox="0 0 16 16" fill="none" stroke="currentColor"
    stroke-width="1.35" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name]}"/></svg>`;
}

export function chatView(webview: vscode.Webview, root: vscode.Uri) {
  const media = vscode.Uri.joinPath(root, 'media', 'chat');
  const bundle = vscode.Uri.joinPath(root, 'dist', 'webview');
  webview.options = { enableScripts: true, localResourceRoots: [media, bundle] };
  const asset = (directory: vscode.Uri, file: string) =>
    webview.asWebviewUri(vscode.Uri.joinPath(directory, file));
  const nonce = randomBytes(18).toString('base64');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; form-action 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'">
  <link rel="stylesheet" href="${asset(media, 'chat.css')}">
  <title>Local Chat</title>
</head>
<body>
  <main id="conversation" aria-label="Conversation" tabindex="0">
    <section id="welcome" aria-labelledby="welcome-title">
      <div class="welcome-content">
        <span class="mark" aria-hidden="true"></span>
        <h1 id="welcome-title">Ask about your code</h1>
        <p id="context-hint">Select code to explain or document it, or stage changes for a commit message.</p>
        <div class="starters" role="group" aria-label="Workspace actions">
          <button type="button" data-action="explain" aria-describedby="context-hint" disabled>${icon('code')}Explain selection</button>
          <button type="button" data-action="doc" aria-describedby="context-hint" disabled>${icon('note')}Document selection</button>
          <button type="button" data-action="commit" disabled>${icon('commit')}Draft commit message</button>
        </div>
      </div>
    </section>
    <div id="turns"></div>
  </main>
  <form aria-label="Chat message">
    <div class="composer">
      <textarea id="prompt" rows="2" aria-label="Message Local Chat" aria-describedby="shortcuts"
        placeholder="Ask a coding question…" spellcheck="false"></textarea>
      <div class="tools">
        <span class="model">${icon('device')}<span id="readiness" role="status">Checking Apple Intelligence…</span></span>
        <button id="send" type="submit" class="action" title="Send message (Enter)" aria-label="Send message" disabled>${icon('send')}</button>
        <button id="stop" type="button" class="action" title="Stop reply (Escape)" aria-label="Stop reply" hidden>${icon('stop')}</button>
      </div>
    </div>
    <div id="shortcuts"><span><kbd>Enter</kbd> to send</span><span><kbd>Shift+Enter</kbd> for a new line</span></div>
    <div id="activity" role="status" class="sr-only"></div>
  </form>
  <script nonce="${nonce}" src="${asset(bundle, 'chat.js')}"></script>
</body>
</html>`;
}
