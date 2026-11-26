import MarkdownIt from 'markdown-it';

// Replies can format text, tables, and strikethrough, but cannot introduce HTML, resources, or navigable URLs.
// Disabling 'reference' also mitigates link-reference ReDoS (GHSA-gfr2-rv44-r23c).
const markdown = new MarkdownIt('default', { html: false, linkify: false }).disable([
  'link',
  'autolink',
  'image',
  'reference',
]);
const DRAFT_DEBOUNCE_MS = 250;
const COPY_FEEDBACK_MS = 1500;
const api = acquireVsCodeApi();
const conversation = document.getElementById('conversation');
const welcome = document.getElementById('welcome');
const starterButtons = welcome.querySelectorAll('button[data-action]');
const turns = document.getElementById('turns');
const input = document.getElementById('prompt');
const send = document.getElementById('send');
const stop = document.getElementById('stop');
const shortcuts = document.getElementById('shortcuts');
const activity = document.getElementById('activity');
const readiness = document.getElementById('readiness');
const copyTimers = new WeakMap();
let conversationId;
let selectedFile;
let busy = false;
let submitting = false;
let latest;
let frame;
let draftTimer;
let deferredPaint = false;

function element(tag, className, content) {
  const node = document.createElement(tag);
  node.className = className;
  if (content) node.textContent = content;
  return node;
}

function nearEnd() {
  return conversation.scrollHeight - conversation.scrollTop - conversation.clientHeight < 48;
}

function shortcutItem(keyText, description) {
  const span = document.createElement('span');
  const kbd = document.createElement('kbd');
  kbd.textContent = keyText;
  span.append(kbd, document.createTextNode(` ${description}`));
  return span;
}

function updateShortcuts() {
  if (busy) {
    shortcuts.replaceChildren(
      shortcutItem('Escape', 'to stop'),
      shortcutItem('Enter', 'for a new line'),
    );
  } else {
    shortcuts.replaceChildren(
      shortcutItem('Enter', 'to send'),
      shortcutItem('Shift+Enter', 'for a new line'),
    );
  }
}

function controls() {
  send.hidden = busy;
  send.disabled = !conversationId || busy || submitting || !input.value.trim();
  stop.hidden = !busy;
  for (const button of starterButtons) {
    const needsSelection = button.dataset.action === 'explain' || button.dataset.action === 'doc';
    button.disabled = !conversationId || busy || submitting || (needsSelection && !selectedFile);
  }
  updateShortcuts();
}

function showSelection(file) {
  selectedFile = file;
  const hint = document.getElementById('context-hint');
  hint.textContent = file
    ? `Use the selection in ${file}, or draft a message for staged changes.`
    : 'Select code to explain or document it, or stage changes for a commit message.';
  controls();
}

function cancelDraftSave() {
  if (draftTimer !== undefined) {
    clearTimeout(draftTimer);
    draftTimer = undefined;
  }
}

function saveDraft() {
  cancelDraftSave();
  if (!conversationId) return;
  const id = conversationId;
  draftTimer = setTimeout(() => {
    draftTimer = undefined;
    if (conversationId === id) {
      api.postMessage({ type: 'draft', conversationId, text: input.value });
    }
  }, DRAFT_DEBOUNCE_MS);
}

function flushDraftSave() {
  if (draftTimer === undefined || !conversationId) return;
  cancelDraftSave();
  api.postMessage({ type: 'draft', conversationId, text: input.value });
}

function hasSelectionInside(container) {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return false;
  for (let i = 0; i < selection.rangeCount; i++) {
    const range = selection.getRangeAt(i);
    if (
      container.contains(range.commonAncestorContainer) ||
      (typeof range.intersectsNode === 'function' && range.intersectsNode(container))
    ) {
      return true;
    }
  }
  return false;
}

function codeLanguage(pre) {
  const code = pre.querySelector('code');
  if (!code) return '';
  for (const name of code.classList) {
    if (name.startsWith('language-')) return name.slice('language-'.length);
  }
  return '';
}

function createCodeHeader(pre) {
  const header = element('div', 'code-header');
  const lang = codeLanguage(pre);
  const label = element('span', 'code-lang', lang);
  const button = element('button', 'copy-code', 'Copy');
  button.type = 'button';
  button.setAttribute('aria-label', lang ? `Copy ${lang} code` : 'Copy code');
  header.append(label, button);
  return header;
}

function wrapCodeBlock(pre) {
  const wrapper = element('div', 'code-block');
  wrapper.append(createCodeHeader(pre), pre);
  return wrapper;
}

function enhanceMarkdown(container) {
  for (const pre of Array.from(container.querySelectorAll('pre'))) {
    if (pre.parentElement?.classList.contains('code-block')) continue;
    const parent = pre.parentNode;
    if (!parent) continue;
    const wrapper = element('div', 'code-block');
    parent.replaceChild(wrapper, pre);
    wrapper.append(createCodeHeader(pre), pre);
  }
  for (const table of Array.from(container.querySelectorAll('table'))) {
    if (table.parentElement?.classList.contains('table-wrap')) continue;
    const parent = table.parentNode;
    if (!parent) continue;
    const wrap = element('div', 'table-wrap');
    parent.replaceChild(wrap, table);
    wrap.append(table);
  }
}

async function copyCode(button) {
  const block = button.closest('.code-block');
  const pre = block?.querySelector('pre');
  if (!pre) return;
  const source = pre.querySelector('code') ?? pre;
  const text = (source.textContent ?? '').replace(/\n$/, '');
  const previousTimer = copyTimers.get(button);
  if (previousTimer !== undefined) clearTimeout(previousTimer);
  const defaultLabel = button.dataset.copyLabel ?? button.getAttribute('aria-label') ?? 'Copy code';
  button.dataset.copyLabel = defaultLabel;
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = 'Copied';
    button.setAttribute('aria-label', 'Copied to clipboard');
    button.dataset.copied = 'true';
    if (!busy) activity.textContent = 'Code copied to clipboard';
  } catch {
    button.textContent = 'Copy failed';
    button.setAttribute('aria-label', 'Copy failed');
    delete button.dataset.copied;
    if (!busy) activity.textContent = 'Failed to copy code';
  }
  const timer = setTimeout(() => {
    copyTimers.delete(button);
    button.textContent = 'Copy';
    button.setAttribute('aria-label', defaultLabel);
    delete button.dataset.copied;
  }, COPY_FEEDBACK_MS);
  copyTimers.set(button, timer);
}

function appendTurn(turn) {
  const article = element('article', 'exchange');
  const question = element('div', 'question');
  question.append(element('span', 'sr-only', 'You: '), document.createTextNode(turn.user));
  const speaker = element('h2', 'speaker');
  const mark = element('span', 'mark');
  mark.setAttribute('aria-hidden', 'true');
  speaker.append(mark, document.createTextNode('Apple On-Device'));
  const answer = element('div', 'answer');
  const notice = element('p', 'notice');
  article.append(question, speaker, answer, notice);
  turns.append(article);
  return { answer, notice, text: '', rendered: undefined, format: turn.format };
}

function paint(reply, preserveSelection = false) {
  if (reply.rendered === reply.text) return true;
  if (preserveSelection && hasSelectionInside(reply.answer)) {
    deferredPaint = true;
    return false;
  }
  deferredPaint = false;
  reply.rendered = reply.text;
  if (!reply.text) {
    reply.answer.replaceChildren();
    return true;
  }
  if (reply.format === 'markdown') {
    reply.answer.innerHTML = markdown.render(reply.text);
    enhanceMarkdown(reply.answer);
  } else if (reply.format === 'code') {
    reply.answer.replaceChildren(wrapCodeBlock(element('pre', 'literal', reply.text)));
  } else {
    reply.answer.textContent = reply.text;
  }
  return true;
}

function schedulePaint() {
  if (frame !== undefined || !latest) return;
  frame = requestAnimationFrame(() => {
    frame = undefined;
    if (!latest) return;
    const follow = nearEnd();
    latest.answer.classList.remove('pending');
    const painted = paint(latest, true);
    if (painted && follow) conversation.scrollTop = conversation.scrollHeight;
  });
}

function updateReply(reply, turn, preserveSelection = false) {
  reply.text = turn.assistant;
  paint(reply, preserveSelection);
  reply.notice.textContent = turn.notice;
}

function render(state) {
  cancelAnimationFrame(frame);
  frame = undefined;
  const reset = conversationId !== state.conversationId;
  const follow = reset || nearEnd();
  const focusPrompt =
    (welcome.contains(document.activeElement) && state.turns.length > 0) ||
    (reset && (conversationId || document.hasFocus())) ||
    (document.activeElement === stop && !state.busy);
  if (reset) {
    cancelDraftSave();
    deferredPaint = false;
    conversationId = state.conversationId;
    input.value = state.draft;
    turns.replaceChildren();
    latest = undefined;
  }
  // Earlier exchanges are immutable. Keep them mounted so selections and scroll positions survive.
  const count = turns.childElementCount;
  for (const turn of state.turns.slice(count)) {
    latest = appendTurn(turn);
    updateReply(latest, turn, false);
  }
  if (latest && state.turns.length === count) {
    updateReply(latest, state.turns.at(-1), state.busy);
  }
  welcome.hidden = state.turns.length > 0;
  readiness.textContent = state.readiness;
  const wasBusy = busy;
  busy = state.busy;
  submitting = false;
  if (!welcome.hidden) showSelection(state.selectedFile);
  else {
    selectedFile = state.selectedFile;
    controls();
  }
  if (latest) {
    latest.answer.classList.toggle('pending', busy && !latest.text);
    if (busy && !latest.text) latest.answer.textContent = 'Generating…';
    else if (!latest.text) latest.answer.replaceChildren();
  }
  if (busy) activity.textContent = 'Generating reply';
  else if (wasBusy && latest) activity.textContent = latest.notice.textContent || 'Reply complete';
  else if (reset) activity.textContent = '';
  if (focusPrompt) input.focus();
  if (follow && !deferredPaint) conversation.scrollTop = conversation.scrollHeight;
}

window.addEventListener('message', ({ data }) => {
  if (data.type === 'focus') input.focus();
  if (data.type === 'state') render(data);
  if (data.type === 'selection') showSelection(data.file);
  if (data.type === 'readiness') readiness.textContent = data.text;
  if (data.type === 'restoreDraft') {
    if (data.conversationId && data.conversationId !== conversationId) return;
    cancelDraftSave();
    if (typeof data.text === 'string') {
      if (!input.value) {
        input.value = data.text;
      } else {
        input.value = `${data.text}\n${input.value}`;
        saveDraft();
      }
    }
    submitting = false;
    controls();
    input.focus();
  }
  if (data.type === 'delta' && latest) {
    latest.text += data.text;
    schedulePaint();
  }
});

document.addEventListener('selectionchange', () => {
  if (deferredPaint && latest && !hasSelectionInside(latest.answer)) {
    schedulePaint();
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushDraftSave();
});

turns.addEventListener('click', (event) => {
  const button = event.target.closest('button.copy-code');
  if (!button) return;
  void copyCode(button);
});

welcome.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button || button.disabled || !conversationId || busy || submitting) return;
  submitting = true;
  controls();
  api.postMessage({ type: 'action', conversationId, action: button.dataset.action });
});

input.addEventListener('input', () => {
  if (conversationId) saveDraft();
  controls();
});

document.querySelector('form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (send.disabled) return;
  cancelDraftSave();
  submitting = true;
  api.postMessage({ type: 'send', conversationId, text: input.value });
  input.value = '';
  controls();
  input.focus();
  conversation.scrollTop = conversation.scrollHeight;
});

document.addEventListener('keydown', (event) => {
  if (event.isComposing) return;
  if (event.target === input && event.key === 'Enter' && !event.shiftKey) {
    if (busy) {
      activity.textContent = 'Reply in progress. Press Escape to stop.';
      return;
    }
    event.preventDefault();
    if (!send.disabled) input.form.requestSubmit();
  } else if (event.key === 'Escape' && busy) {
    event.preventDefault();
    api.postMessage({ type: 'stop', conversationId });
  }
});

stop.addEventListener('click', () => api.postMessage({ type: 'stop', conversationId }));
api.postMessage({ type: 'ready' });
