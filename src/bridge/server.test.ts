import { describe, expect, it } from 'vitest';
import { serverArgsFor } from './server';

describe('serverArgsFor', () => {
  it('uses `serve --host 127.0.0.1 --port` for the system fm CLI', () => {
    expect(serverArgsFor('fm', 9999)).toEqual(['serve', '--host', '127.0.0.1', '--port', '9999']);
    expect(serverArgsFor('/usr/bin/fm', 8080)).toEqual([
      'serve',
      '--host',
      '127.0.0.1',
      '--port',
      '8080',
    ]);
  });

  it('uses `-p` for the afm fallback bridge', () => {
    expect(serverArgsFor('afm', 9999)).toEqual(['-p', '9999']);
    expect(serverArgsFor('/opt/homebrew/bin/afm', 9998)).toEqual(['-p', '9998']);
    expect(serverArgsFor('afm-next', 9999)).toEqual(['-p', '9999']);
  });

  it('defaults unknown executables to the fm-style interface with loopback host', () => {
    expect(serverArgsFor('/usr/local/bin/my-bridge', 9999)).toEqual([
      'serve',
      '--host',
      '127.0.0.1',
      '--port',
      '9999',
    ]);
  });
});
