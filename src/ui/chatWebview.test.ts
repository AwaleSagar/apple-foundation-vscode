import MarkdownIt from 'markdown-it';
import { afterEach, describe, expect, it, vi } from 'vitest';

function createHardenedMarkdown() {
  return new MarkdownIt('default', { html: false, linkify: false }).disable([
    'link',
    'autolink',
    'image',
    'reference',
  ]);
}

class FakeClassList {
  private readonly set = new Set<string>();
  add(...names: string[]) {
    for (const n of names) if (n) this.set.add(n);
  }
  remove(...names: string[]) {
    for (const n of names) this.set.delete(n);
  }
  toggle(name: string, force?: boolean) {
    if (force === undefined) {
      if (this.set.has(name)) {
        this.set.delete(name);
        return false;
      }
      this.set.add(name);
      return true;
    }
    if (force) this.set.add(name);
    else this.set.delete(name);
    return force;
  }
  contains(name: string) {
    return this.set.has(name);
  }
  [Symbol.iterator]() {
    return this.set[Symbol.iterator]();
  }
  setFromString(value: string) {
    this.set.clear();
    for (const part of value.split(/\s+/)) {
      if (part) this.set.add(part);
    }
  }
  toString() {
    return Array.from(this.set).join(' ');
  }
}

class FakeNode {
  parentNode: FakeElement | null = null;
  get parentElement(): FakeElement | null {
    return this.parentNode;
  }
  textContent = '';
}

class FakeText extends FakeNode {
  constructor(text: string) {
    super();
    this.textContent = text;
  }
}

class FakeElement extends FakeNode {
  readonly tagName: string;
  readonly children: FakeNode[] = [];
  readonly classList = new FakeClassList();
  readonly dataset: Record<string, string> = {};
  readonly attributes = new Map<string, string>();
  readonly listeners = new Map<string, ((event: Record<string, unknown>) => void)[]>();
  id = '';
  hidden = false;
  disabled = false;
  value = '';
  type = '';
  scrollHeight = 100;
  scrollTop = 100;
  clientHeight = 100;
  form: FakeElement | null = null;
  private rawHtml = '';
  focused = false;

  constructor(tag: string) {
    super();
    this.tagName = tag.toUpperCase();
  }

  get className() {
    return this.classList.toString();
  }
  set className(value: string) {
    this.classList.setFromString(value);
  }

  get childElementCount() {
    return this.children.filter((c): c is FakeElement => c instanceof FakeElement).length;
  }

  get innerHTML() {
    return this.rawHtml;
  }
  set innerHTML(html: string) {
    this.rawHtml = html;
    this.children.length = 0;
    // Minimal parser for <pre><code class="...">...</code></pre> and <table>...</table>
    const preRegex = /<pre>(?:<code(?:\s+class="([^"]*)")?>([\s\S]*?)<\/code>)?<\/pre>/g;
    let match: RegExpExecArray | null = preRegex.exec(html);
    while (match !== null) {
      const pre = new FakeElement('pre');
      if (match[2] !== undefined) {
        const code = new FakeElement('code');
        if (match[1]) code.className = match[1];
        code.textContent = match[2]
          .replaceAll('&lt;', '<')
          .replaceAll('&gt;', '>')
          .replaceAll('&amp;', '&');
        pre.append(code);
      }
      this.append(pre);
      match = preRegex.exec(html);
    }
    if (html.includes('<table>')) {
      const table = new FakeElement('table');
      table.textContent = html;
      this.append(table);
    }
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
    if (name === 'class') this.className = value;
  }
  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }

  append(...nodes: FakeNode[]) {
    for (const node of nodes) {
      if (node.parentNode) {
        const index = node.parentNode.children.indexOf(node);
        if (index >= 0) node.parentNode.children.splice(index, 1);
      }
      node.parentNode = this;
      this.children.push(node);
    }
  }

  replaceChildren(...nodes: FakeNode[]) {
    for (const child of this.children) child.parentNode = null;
    this.children.length = 0;
    this.rawHtml = '';
    this.append(...nodes);
  }

  replaceChild(newChild: FakeNode, oldChild: FakeNode) {
    const index = this.children.indexOf(oldChild);
    if (index < 0) return oldChild;
    oldChild.parentNode = null;
    newChild.parentNode = this;
    this.children[index] = newChild;
    return oldChild;
  }

  contains(target: FakeNode | null): boolean {
    if (!target) return false;
    let current: FakeNode | null = target;
    while (current) {
      if (current === this) return true;
      current = current.parentNode;
    }
    return false;
  }

  matches(selector: string): boolean {
    if (
      selector === 'pre' ||
      selector === 'table' ||
      selector === 'code' ||
      selector === 'button'
    ) {
      return this.tagName === selector.toUpperCase();
    }
    if (selector === 'button.copy-code') {
      return this.tagName === 'BUTTON' && this.classList.contains('copy-code');
    }
    if (selector === '.code-block') {
      return this.classList.contains('code-block');
    }
    if (selector === 'button[data-action]') {
      return this.tagName === 'BUTTON' && typeof this.dataset['action'] === 'string';
    }
    return false;
  }

  closest(selector: string): FakeElement | null {
    let current: FakeElement | null = this;
    while (current) {
      if (current.matches(selector)) return current;
      current = current.parentNode;
    }
    return null;
  }

  querySelectorAll(selector: string): FakeElement[] {
    const results: FakeElement[] = [];
    const walk = (node: FakeElement) => {
      for (const child of node.children) {
        if (child instanceof FakeElement) {
          if (child.matches(selector)) results.push(child);
          walk(child);
        }
      }
    };
    walk(this);
    return results;
  }

  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  addEventListener(type: string, listener: (event: Record<string, unknown>) => void) {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  dispatch(type: string, event: Record<string, unknown> = {}) {
    const list = this.listeners.get(type) ?? [];
    for (const listener of list) listener(event);
  }

  focus() {
    this.focused = true;
  }

  requestSubmit() {
    this.dispatch('submit', { preventDefault: () => undefined });
  }
}

describe('markdown hardening', () => {
  it('enables GFM tables and strikethrough while disabling HTML, links, images, autolinks, and references', async () => {
    const md = createHardenedMarkdown();

    const tableHtml = md.render('| Col A | Col B |\n| --- | --- |\n| 1 | 2 |');
    expect(tableHtml).toContain('<table>');
    expect(tableHtml).toContain('<th>Col A</th>');
    expect(tableHtml).toContain('<td>2</td>');

    expect(md.render('~~removed~~')).toContain('<s>removed</s>');

    const unsafe = md.render(
      [
        '<script>alert(1)</script>',
        '[click](https://evil.test)',
        '<https://evil.test>',
        '![img](https://evil.test/x.png)',
        '[ref][id]\n\n[id]: https://evil.test',
        'https://evil.test',
      ].join('\n\n'),
    );
    expect(unsafe).not.toContain('<script');
    expect(unsafe).not.toContain('<a ');
    expect(unsafe).not.toContain('<img');
  });

  it('handles link-reference ReDoS payloads quickly with reference rule disabled', async () => {
    const md = createHardenedMarkdown();
    const payload = `[a]: ${' '.repeat(20_000)}\n`.repeat(5);
    const start = performance.now();
    md.render(payload);
    expect(performance.now() - start).toBeLessThan(250);
  });
});

describe('chat.js webview behavior', () => {
  const globals = globalThis as unknown as Record<string, unknown>;
  const originalGlobals = {
    window: globals['window'],
    document: globals['document'],
    navigator: globals['navigator'],
    requestAnimationFrame: globals['requestAnimationFrame'],
    cancelAnimationFrame: globals['cancelAnimationFrame'],
    acquireVsCodeApi: globals['acquireVsCodeApi'],
  };

  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
    for (const [key, value] of Object.entries(originalGlobals)) {
      Object.defineProperty(globalThis, key, {
        value,
        configurable: true,
        writable: true,
      });
    }
  });

  async function mountWebview() {
    vi.useFakeTimers();
    const posted: Record<string, unknown>[] = [];
    const windowListeners = new Map<string, ((event: Record<string, unknown>) => void)[]>();
    const docListeners = new Map<string, ((event: Record<string, unknown>) => void)[]>();
    const frames = new Map<number, () => void>();
    let nextFrame = 1;
    let clipboardText = '';
    let activeSelection: {
      isCollapsed: boolean;
      rangeCount: number;
      getRangeAt: (index: number) => { commonAncestorContainer: FakeNode };
    } = {
      isCollapsed: true,
      rangeCount: 0,
      getRangeAt: () => ({ commonAncestorContainer: new FakeText('') }),
    };

    const conversation = new FakeElement('main');
    const welcome = new FakeElement('section');
    const contextHint = new FakeElement('p');
    const explainBtn = new FakeElement('button');
    explainBtn.dataset['action'] = 'explain';
    explainBtn.disabled = true;
    const docBtn = new FakeElement('button');
    docBtn.dataset['action'] = 'doc';
    docBtn.disabled = true;
    const commitBtn = new FakeElement('button');
    commitBtn.dataset['action'] = 'commit';
    commitBtn.disabled = true;
    welcome.append(contextHint, explainBtn, docBtn, commitBtn);

    const turns = new FakeElement('div');
    const form = new FakeElement('form');
    const input = new FakeElement('textarea');
    input.form = form;
    const send = new FakeElement('button');
    send.disabled = true;
    const stop = new FakeElement('button');
    stop.hidden = true;
    const shortcuts = new FakeElement('div');
    const activity = new FakeElement('div');
    const readiness = new FakeElement('span');

    const byId: Record<string, FakeElement> = {
      conversation,
      welcome,
      'context-hint': contextHint,
      turns,
      prompt: input,
      send,
      stop,
      shortcuts,
      activity,
      readiness,
    };

    const fakeDoc = {
      activeElement: null as FakeElement | null,
      visibilityState: 'visible',
      hasFocus: () => true,
      getElementById: (id: string) => byId[id] ?? null,
      querySelector: (selector: string) => (selector === 'form' ? form : null),
      createElement: (tag: string) => new FakeElement(tag),
      createTextNode: (text: string) => new FakeText(text),
      addEventListener: (type: string, listener: (event: Record<string, unknown>) => void) => {
        const list = docListeners.get(type) ?? [];
        list.push(listener);
        docListeners.set(type, list);
      },
    };

    const fakeWindow = {
      addEventListener: (type: string, listener: (event: Record<string, unknown>) => void) => {
        const list = windowListeners.get(type) ?? [];
        list.push(listener);
        windowListeners.set(type, list);
      },
      getSelection: () => activeSelection,
    };

    const fakeNavigator = {
      clipboard: {
        writeText: vi.fn(async (text: string) => {
          clipboardText = text;
        }),
      },
    };

    Object.defineProperty(globalThis, 'window', {
      value: fakeWindow,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, 'document', {
      value: fakeDoc,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, 'navigator', {
      value: fakeNavigator,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, 'requestAnimationFrame', {
      value: (cb: () => void) => {
        const id = nextFrame++;
        frames.set(id, cb);
        return id;
      },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, 'cancelAnimationFrame', {
      value: (id: number) => {
        frames.delete(id);
      },
      configurable: true,
      writable: true,
    });
    (globalThis as Record<string, unknown>)['acquireVsCodeApi'] = () => ({
      postMessage: (message: Record<string, unknown>) => posted.push(message),
    });

    // @ts-expect-error media/chat/chat.js is an untyped webview script bundled by esbuild.
    await import('../../media/chat/chat.js');

    return {
      posted,
      elements: {
        welcome,
        explainBtn,
        docBtn,
        commitBtn,
        turns,
        form,
        input,
        send,
        stop,
        shortcuts,
        activity,
      },
      clipboard: fakeNavigator.clipboard,
      getClipboardText: () => clipboardText,
      setSelection: (node: FakeNode | null) => {
        if (!node) {
          activeSelection = {
            isCollapsed: true,
            rangeCount: 0,
            getRangeAt: () => ({ commonAncestorContainer: new FakeText('') }),
          };
        } else {
          activeSelection = {
            isCollapsed: false,
            rangeCount: 1,
            getRangeAt: () => ({ commonAncestorContainer: node }),
          };
        }
      },
      sendFromHost: (data: Record<string, unknown>) => {
        for (const listener of windowListeners.get('message') ?? []) listener({ data });
      },
      dispatchDoc: (type: string, event: Record<string, unknown> = {}) => {
        for (const listener of docListeners.get(type) ?? []) listener(event);
      },
      flushFrames: () => {
        const pending = Array.from(frames.entries());
        frames.clear();
        for (const [, cb] of pending) cb();
      },
    };
  }

  it('debounces draft saves, avoids empty draft overwrite on submit, and restores rejected drafts', async () => {
    const env = await mountWebview();
    expect(env.posted).toEqual([{ type: 'ready' }]);
    env.posted.length = 0;

    env.sendFromHost({
      type: 'state',
      conversationId: 'conv-1',
      draft: '',
      selectedFile: undefined,
      turns: [],
      busy: false,
      readiness: 'On device',
    });

    // Rapid typing should debounce draft IPC to a single post after 250ms.
    env.elements.input.value = 'h';
    env.elements.input.dispatch('input');
    env.elements.input.value = 'he';
    env.elements.input.dispatch('input');
    env.elements.input.value = 'hello';
    env.elements.input.dispatch('input');
    expect(env.posted).toEqual([]);

    vi.advanceTimersByTime(250);
    expect(env.posted).toEqual([{ type: 'draft', conversationId: 'conv-1', text: 'hello' }]);
    env.posted.length = 0;

    // Submitting sends 'send' and does NOT post an empty 'draft' message.
    env.elements.input.value = 'hello world';
    env.elements.input.dispatch('input');
    env.elements.form.requestSubmit();
    vi.advanceTimersByTime(500);
    expect(env.posted).toEqual([{ type: 'send', conversationId: 'conv-1', text: 'hello world' }]);
    expect(env.elements.input.value).toBe('');

    // Host rejects send while busy and sends restoreDraft.
    env.elements.input.focused = false;
    env.sendFromHost({
      type: 'restoreDraft',
      conversationId: 'conv-1',
      text: 'hello world',
    });
    expect(env.elements.input.value).toBe('hello world');
    expect(env.elements.input.focused).toBe(true);
    expect(env.elements.send.disabled).toBe(false);
  });

  it('guards starter buttons with submitting state and does not swallow Enter while busy', async () => {
    const env = await mountWebview();
    env.posted.length = 0;

    env.sendFromHost({
      type: 'state',
      conversationId: 'conv-1',
      draft: '',
      selectedFile: 'app.ts',
      turns: [],
      busy: false,
      readiness: 'On device',
    });

    expect(env.elements.commitBtn.disabled).toBe(false);
    expect(env.elements.explainBtn.disabled).toBe(false);

    // Clicking a starter disables all starters immediately until state syncs back.
    env.elements.welcome.dispatch('click', { target: env.elements.explainBtn });
    expect(env.posted).toEqual([{ type: 'action', conversationId: 'conv-1', action: 'explain' }]);
    expect(env.elements.explainBtn.disabled).toBe(true);
    expect(env.elements.commitBtn.disabled).toBe(true);

    // Second click before state sync is ignored.
    env.elements.welcome.dispatch('click', { target: env.elements.commitBtn });
    expect(env.posted).toHaveLength(1);

    // While busy, pressing Enter does not call preventDefault() and hints status.
    env.sendFromHost({
      type: 'state',
      conversationId: 'conv-1',
      draft: '',
      selectedFile: 'app.ts',
      turns: [{ user: 'Explain selection', assistant: '', notice: '', format: 'markdown' }],
      busy: true,
      readiness: 'On device',
    });
    const preventDefault = vi.fn();
    env.dispatchDoc('keydown', {
      target: env.elements.input,
      key: 'Enter',
      shiftKey: false,
      isComposing: false,
      preventDefault,
    });
    expect(preventDefault).not.toHaveBeenCalled();
    expect(env.elements.activity.textContent).toContain('Escape');
  });

  it('preserves active user selection during streaming deltas and provides Copy button on code blocks', async () => {
    const env = await mountWebview();

    env.sendFromHost({
      type: 'state',
      conversationId: 'conv-1',
      draft: '',
      selectedFile: undefined,
      turns: [{ user: 'show code', assistant: '', notice: '', format: 'markdown' }],
      busy: true,
      readiness: 'On device',
    });

    // First delta paints a fenced code block with a Copy button.
    env.sendFromHost({ type: 'delta', text: '```ts\nconst x = 1;\n```\n' });
    env.flushFrames();

    const copyBtn = env.elements.turns.querySelector('button.copy-code');
    expect(copyBtn).not.toBeNull();
    expect(copyBtn?.getAttribute('aria-label')).toBe('Copy ts code');

    // Simulate active text selection inside latest answer.
    const answerNode = env.elements.turns.querySelector('pre');
    expect(answerNode).not.toBeNull();
    env.setSelection(answerNode);

    const htmlBefore = answerNode?.parentElement?.parentElement?.innerHTML;
    env.sendFromHost({ type: 'delta', text: 'More streaming text' });
    env.flushFrames();
    // Paint was deferred so selection was not wiped.
    expect(answerNode?.parentElement?.parentElement?.innerHTML).toBe(htmlBefore);

    // Clearing selection triggers deferred paint on next animation frame.
    env.setSelection(null);
    env.dispatchDoc('selectionchange');
    env.flushFrames();
    const updatedAnswer = env.elements.turns.querySelector('pre')?.parentElement?.parentElement;
    expect(updatedAnswer?.innerHTML).toContain('More streaming text');

    // Clicking Copy writes code to clipboard and updates button feedback.
    const latestCopyBtn = env.elements.turns.querySelector('button.copy-code');
    expect(latestCopyBtn).not.toBeNull();
    env.elements.turns.dispatch('click', { target: latestCopyBtn });
    await Promise.resolve();
    expect(env.clipboard.writeText).toHaveBeenCalledWith('const x = 1;');
    expect(env.getClipboardText()).toBe('const x = 1;');
    expect(latestCopyBtn?.textContent).toBe('Copied');
    expect(latestCopyBtn?.dataset['copied']).toBe('true');

    vi.advanceTimersByTime(1500);
    expect(latestCopyBtn?.textContent).toBe('Copy');
    expect(latestCopyBtn?.dataset['copied']).toBeUndefined();

    // Literal code replies (format === 'code') also receive a Copy button.
    env.sendFromHost({
      type: 'state',
      conversationId: 'conv-1',
      draft: '',
      selectedFile: undefined,
      turns: [
        {
          user: 'show code',
          assistant: '```ts\nconst x = 1;\n```\nMore streaming text',
          notice: '',
          format: 'markdown',
        },
        {
          user: 'Document selection',
          assistant: '/// Doubles the input.',
          notice: '',
          format: 'code',
        },
      ],
      busy: false,
      readiness: 'On device',
    });
    const allCopyButtons = env.elements.turns.querySelectorAll('button.copy-code');
    expect(allCopyButtons).toHaveLength(2);
    const literalCopyBtn = allCopyButtons[1];
    env.elements.turns.dispatch('click', { target: literalCopyBtn });
    await Promise.resolve();
    expect(env.getClipboardText()).toBe('/// Doubles the input.');
  });
});
