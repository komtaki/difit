import { appendFileSync } from 'node:fs';

const mode = process.env.FAKE_LSP_MODE ?? 'normal';
const logPath = process.env.FAKE_LSP_LOG;
const loadingMs = Number(process.env.FAKE_LSP_LOADING_MS ?? 300);
const initializeDelayMs = Number(process.env.FAKE_LSP_INITIALIZE_DELAY_MS ?? 0);
let selfAnswersLeft = Number(process.env.FAKE_LSP_SELF_ANSWERS ?? 0);
let isLoading = false;

process.stderr.write('fake language server booting\n');

if (mode === 'noisy-crash') {
  process.stderr.write('loading project\n'.repeat(500));
}

if (mode === 'crash' || mode === 'noisy-crash') {
  process.stderr.write('fatal: cannot start\n');
  process.exit(3);
}

function log(entry) {
  if (logPath) {
    appendFileSync(logPath, `${JSON.stringify(entry)}\n`);
  }
}

function send(message) {
  const body = JSON.stringify({ jsonrpc: '2.0', ...message });
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
}

function location(uri, line, character) {
  return {
    uri,
    range: { start: { line, character }, end: { line, character: character + 5 } },
  };
}

function startProjectLoading() {
  isLoading = true;
  send({
    id: 'progress-create',
    method: 'window/workDoneProgress/create',
    params: { token: 'load' },
  });
  send({
    method: '$/progress',
    params: { token: 'load', value: { kind: 'begin', title: 'Loading' } },
  });
  setTimeout(() => {
    isLoading = false;
    send({ method: '$/progress', params: { token: 'load', value: { kind: 'end' } } });
  }, loadingMs);
}

function handleRequest({ id, method, params }) {
  switch (method) {
    case 'initialize':
      setTimeout(
        () =>
          send({
            id,
            result: { capabilities: { definitionProvider: true, referencesProvider: true } },
          }),
        initializeDelayMs,
      );
      return;
    case 'textDocument/definition':
      if (mode === 'hang') {
        return;
      }
      if (isLoading || selfAnswersLeft > 0) {
        selfAnswersLeft -= 1;
        send({
          id,
          result: [
            location(params.textDocument.uri, params.position.line, params.position.character),
          ],
        });
        return;
      }
      send({
        id,
        result: [
          {
            targetUri: params.textDocument.uri,
            targetRange: { start: { line: 0, character: 0 }, end: { line: 2, character: 1 } },
            targetSelectionRange: {
              start: { line: 1, character: 9 },
              end: { line: 1, character: 14 },
            },
          },
        ],
      });
      return;
    case 'textDocument/references':
      send({
        id,
        result: [
          location(params.textDocument.uri, params.position.line, params.position.character),
          location('file:///outside/repository/types.d.ts', 4, 2),
        ],
      });
      return;
    case 'shutdown':
      send({ id, result: null });
      return;
    default:
      send({ id, error: { code: -32601, message: `Unhandled method ${method}` } });
  }
}

let buffer = Buffer.alloc(0);

process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd < 0) {
      return;
    }
    const length = Number(
      /Content-Length: (\d+)/i.exec(buffer.subarray(0, headerEnd).toString())[1],
    );
    const bodyStart = headerEnd + 4;
    if (buffer.length < bodyStart + length) {
      return;
    }
    const message = JSON.parse(buffer.subarray(bodyStart, bodyStart + length).toString());
    buffer = buffer.subarray(bodyStart + length);

    log({ method: message.method, params: message.params });
    if (message.method === 'exit') {
      process.exit(0);
    }
    if (message.method === 'initialized' && mode === 'progress') {
      startProjectLoading();
    }
    if (message.id !== undefined && message.method) {
      handleRequest(message);
    }
  }
});
