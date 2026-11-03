import { appendFileSync } from 'node:fs';

const mode = process.env.FAKE_LSP_MODE ?? 'normal';
const logPath = process.env.FAKE_LSP_LOG;

process.stderr.write('fake language server booting\n');

if (mode === 'crash') {
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

function handleRequest({ id, method, params }) {
  switch (method) {
    case 'initialize':
      send({
        id,
        result: { capabilities: { definitionProvider: true, referencesProvider: true } },
      });
      return;
    case 'textDocument/definition':
      if (mode === 'hang') {
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
    if (message.id !== undefined && message.method) {
      handleRequest(message);
    }
  }
});
