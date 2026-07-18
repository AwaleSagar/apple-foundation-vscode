/**
 * Incremental Server-Sent Events parser.
 *
 * Network chunks do not align with event boundaries, so the parser buffers
 * partial events across `push` calls and emits only complete `data:` payloads.
 */
export class SseParser {
  private buffer = '';

  /** Feed a decoded chunk; returns the data payloads of any completed events. */
  push(chunk: string): string[] {
    this.buffer += chunk.replaceAll('\r\n', '\n');
    const payloads: string[] = [];

    let boundary = this.buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const rawEvent = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary + 2);

      const dataLines = rawEvent
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice('data:'.length).trimStart());

      if (dataLines.length > 0) {
        payloads.push(dataLines.join('\n'));
      }
      boundary = this.buffer.indexOf('\n\n');
    }

    return payloads;
  }
}
