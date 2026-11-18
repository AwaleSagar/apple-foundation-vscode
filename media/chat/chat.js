import MarkdownIt from 'markdown-it';

// Replies can format text, but cannot introduce HTML, resources, or navigable URLs.
const markdown = new MarkdownIt('commonmark', { html: false }).disable([
  'link',
  'autolink',
  'image',
]);
const api = acquireVsCodeApi();
const conversation = document.getElementById('conversation');
const welcome = document.getElementById('welcome');
const selectionActions = welcome.querySelectorAll('[data-action="explain"], [data-action="doc"]');
const turns = document.getElementById('turns');
const input = document.getElementById('prompt');
const send = document.getElementById('send');
const stop = document.getElementById('stop');
const activity = document.getElementById('activity');
const readiness = document.getElementById('readiness');
let conversationId;
let busy = false;
let submitting = false;
let latest;
let frame;

function element(tag, className, content) {
  const node = document.createElement(tag);
  node.className = className;
  if (content) node.textContent = content;
  return node;
}

function nearEnd() {
  return conversation.scrollHeight - conversation.scrollTop - conversation.clientHeight < 48;
}

function controls() {
  send.hidden = busy;
  send.disabled = !conversationId || busy || submitting || !input.value.trim();
  stop.hidden = !busy;
}

function showSelection(file) {
  const hint = document.getElementById('context-hint');
  hint.textContent = file
    ? `Use the selection in ${file}, or draft a message for staged changes.`
    : 'Select code to explain or document it, or stage changes for a commit message.';
  for (const button of selectionActions) button.disabled = !file;
}

function saveDraft() {
  api.postMessage({ type: 'draft', conversationId, text: input.value });
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

function paint(reply) {
  if (reply.rendered === reply.text) return;
  reply.rendered = reply.text;
  if (reply.format === 'markdown') {
    reply.answer.innerHTML = markdown.render(reply.text);
  } else if (reply.format === 'code') {
    reply.answer.replaceChildren(element('pre', 'literal', reply.text));
  } else {
    reply.answer.textContent = reply.text;
  }
}

function updateReply(reply, turn) {
  reply.text = turn.assistant;
  paint(reply);
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
    conversationId = state.conversationId;
    input.value = state.draft;
    turns.replaceChildren();
    latest = undefined;
  }
  // Earlier exchanges are immutable. Keep them mounted so selections and scroll positions survive.
  const count = turns.childElementCount;
  for (const turn of state.turns.slice(count)) {
    latest = appendTurn(turn);
    updateReply(latest, turn);
  }
  if (latest && state.turns.length === count) updateReply(latest, state.turns.at(-1));
  welcome.hidden = state.turns.length > 0;
  if (!welcome.hidden) showSelection(state.selectedFile);
  readiness.textContent = state.readiness;
  const wasBusy = busy;
  busy = state.busy;
  submitting = false;
  controls();
  if (latest) {
    latest.answer.classList.toggle('pending', busy && !latest.text);
    if (busy && !latest.text) latest.answer.textContent = 'Generating…';
    else if (!latest.text) latest.answer.replaceChildren();
  }
  if (busy) activity.textContent = 'Generating reply';
  else if (wasBusy && latest) activity.textContent = latest.notice.textContent || 'Reply complete';
  else if (reset) activity.textContent = '';
  if (focusPrompt) input.focus();
  if (follow) conversation.scrollTop = conversation.scrollHeight;
}

window.addEventListener('message', ({ data }) => {
  if (data.type === 'focus') input.focus();
  if (data.type === 'state') render(data);
  if (data.type === 'selection') showSelection(data.file);
  if (data.type === 'readiness') readiness.textContent = data.text;
  if (data.type === 'delta' && latest) {
    latest.text += data.text;
    if (frame !== undefined) return;
    frame = requestAnimationFrame(() => {
      frame = undefined;
      const follow = nearEnd();
      latest.answer.classList.remove('pending');
      paint(latest);
      if (follow) conversation.scrollTop = conversation.scrollHeight;
    });
  }
});

welcome.addEventListener('click', (event) => {
  const action = event.target.closest('button')?.dataset.action;
  if (action && conversationId && !busy)
    api.postMessage({ type: 'action', conversationId, action });
});
input.addEventListener('input', () => {
  if (conversationId) saveDraft();
  controls();
});
document.querySelector('form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (send.disabled) return;
  submitting = true;
  api.postMessage({ type: 'send', conversationId, text: input.value });
  input.value = '';
  saveDraft();
  controls();
  input.focus();
  conversation.scrollTop = conversation.scrollHeight;
});
document.addEventListener('keydown', (event) => {
  if (event.isComposing) return;
  if (event.target === input && event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    if (!send.disabled) input.form.requestSubmit();
  } else if (event.key === 'Escape' && busy) {
    event.preventDefault();
    api.postMessage({ type: 'stop', conversationId });
  }
});
stop.addEventListener('click', () => api.postMessage({ type: 'stop', conversationId }));
api.postMessage({ type: 'ready' });
