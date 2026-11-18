const api = acquireVsCodeApi();
const turns = document.getElementById('turns');
const input = document.getElementById('prompt');
const send = document.getElementById('send');
const stop = document.getElementById('stop');
const activity = document.getElementById('activity');
let lastAnswer;

function textElement(tag, value, className) {
  const element = document.createElement(tag);
  element.textContent = value;
  element.className = className;
  return element;
}

function render(state) {
  const nearEnd = turns.scrollHeight - turns.scrollTop - turns.clientHeight < 60;
  turns.replaceChildren();
  lastAnswer = undefined;
  for (const turn of state.turns) {
    const section = document.createElement('article');
    section.append(textElement('h2', 'You', 'speaker'), textElement('p', turn.user, 'message'));
    lastAnswer = textElement('p', turn.assistant, 'message');
    section.append(textElement('h2', 'Apple On-Device', 'speaker'), lastAnswer);
    if (turn.notice) {
      const note = textElement('p', turn.notice, 'notice');
      note.setAttribute('role', 'status');
      section.append(note);
    }
    turns.append(section);
  }
  if (nearEnd) turns.scrollTop = turns.scrollHeight;
  document.getElementById('readiness').textContent = state.readiness;
  activity.textContent = state.busy ? 'Generating…' : state.turns.length ? 'Ready' : '';
  send.disabled = state.busy;
  stop.hidden = !state.busy;
}
window.addEventListener('message', ({ data }) => {
  if (data.type === 'state') render(data);
  if (data.type === 'readiness') document.getElementById('readiness').textContent = data.text;
  if (data.type === 'delta' && lastAnswer) {
    const nearEnd = turns.scrollHeight - turns.scrollTop - turns.clientHeight < 60;
    lastAnswer.append(document.createTextNode(data.text));
    if (nearEnd) turns.scrollTop = turns.scrollHeight;
  }
});
const form = document.querySelector('form');
form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!input.value.trim() || send.disabled) return;
  api.postMessage({ type: 'send', text: input.value });
  send.disabled = true;
  input.value = '';
  input.focus();
});
input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    form.requestSubmit();
  }
});
stop.addEventListener('click', () => api.postMessage({ type: 'stop' }));
document.getElementById('new').addEventListener('click', () => {
  api.postMessage({ type: 'new' });
  input.value = '';
  input.focus();
});
api.postMessage({ type: 'ready' });
