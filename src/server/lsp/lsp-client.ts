import { spawn } from 'child_process';
import { basename } from 'path';
import { pathToFileURL } from 'url';

import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from 'vscode-jsonrpc/node';

const STDERR_LIMIT = 2000;
const SHUTDOWN_TIMEOUT_MS = 2000;

interface LspPosition {
  line: number;
  character: number;
}

interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

type DefinitionResult =
  | { uri: string; range: LspRange }
  | Array<{ uri: string; range: LspRange }>
  | Array<{ targetUri: string; targetRange: LspRange; targetSelectionRange?: LspRange }>
  | null;

interface LspDocument {
  absolutePath: string;
  languageId: string;
  content: string;
}

export interface LspRawLocation {
  uri: string;
  line: number;
  character: number;
}

export interface LspClient {
  definition(document: LspDocument, position: LspPosition): Promise<LspRawLocation[]>;
  references(document: LspDocument, position: LspPosition): Promise<LspRawLocation[]>;
  onExit(listener: (detail: string) => void): void;
  shutdown(): Promise<void>;
  kill(): void;
}

export class LspRequestTimeoutError extends Error {
  constructor(method: string, timeoutMs: number) {
    super(`Language server did not answer ${method} within ${timeoutMs}ms`);
    this.name = 'LspRequestTimeoutError';
  }
}

function withTimeout<T>(promise: Promise<T>, method: string, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new LspRequestTimeoutError(method, timeoutMs)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function toRawLocations(result: DefinitionResult): LspRawLocation[] {
  if (!result) {
    return [];
  }

  return (Array.isArray(result) ? result : [result]).map((location) => {
    if ('targetUri' in location) {
      const range = location.targetSelectionRange ?? location.targetRange;
      return { uri: location.targetUri, ...range.start };
    }
    return { uri: location.uri, ...location.range.start };
  });
}

function describeFailure(message: string, stderr: string): string {
  const trimmedStderr = stderr.trim();
  return trimmedStderr ? `${message}\n${trimmedStderr}` : message;
}

export async function startLspClient(options: {
  command: string;
  args: string[];
  rootPath: string;
  timeoutMs: number;
}): Promise<LspClient> {
  const child = spawn(options.command, options.args, {
    cwd: options.rootPath,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stderr = '';
  let exitDetail: string | undefined;
  const exitListeners: Array<(detail: string) => void> = [];

  child.stderr.on('data', (chunk: Buffer) => {
    if (stderr.length < STDERR_LIMIT) {
      stderr = `${stderr}${chunk.toString('utf8')}`.slice(0, STDERR_LIMIT);
    }
  });
  child.stdin.on('error', () => {});

  const exited = new Promise<string>((resolve) => {
    const finish = (detail: string) => {
      if (exitDetail !== undefined) {
        return;
      }
      exitDetail = describeFailure(detail, stderr);
      for (const listener of exitListeners) {
        listener(exitDetail);
      }
      resolve(exitDetail);
    };
    child.once('error', (error) => finish(`Failed to start ${options.command}: ${error.message}`));
    child.once('exit', (code, signal) =>
      finish(`${basename(options.command)} exited (${signal ?? `code ${code}`})`),
    );
  });

  const connection = createMessageConnection(
    new StreamMessageReader(child.stdout),
    new StreamMessageWriter(child.stdin),
  );
  connection.onRequest('workspace/configuration', (params: { items?: unknown[] }) =>
    (params.items ?? []).map(() => null),
  );
  connection.onRequest('client/registerCapability', () => null);
  connection.onRequest('window/workDoneProgress/create', () => null);
  connection.onError(() => {});
  connection.listen();

  const request = async <T>(method: string, params: unknown, timeoutMs = options.timeoutMs) => {
    const response = connection.sendRequest<T>(method, params);
    const failure = exited.then((detail) => Promise.reject(new Error(detail)));
    return withTimeout(Promise.race([response, failure]), method, timeoutMs);
  };

  const kill = () => {
    connection.dispose();
    if (exitDetail === undefined) {
      child.kill();
    }
  };

  const rootUri = pathToFileURL(options.rootPath).href;
  try {
    await request('initialize', {
      processId: process.pid,
      rootUri,
      workspaceFolders: [{ uri: rootUri, name: basename(options.rootPath) }],
      capabilities: {
        textDocument: {
          synchronization: { didSave: false },
          definition: { linkSupport: true },
          references: {},
        },
        workspace: { configuration: true, workspaceFolders: true },
      },
    });
    await connection.sendNotification('initialized', {});
  } catch (error) {
    kill();
    throw error;
  }

  const openDocuments = new Map<string, { version: number; content: string }>();

  const syncDocument = async (document: LspDocument): Promise<string> => {
    const uri = pathToFileURL(document.absolutePath).href;
    const opened = openDocuments.get(uri);
    if (!opened) {
      openDocuments.set(uri, { version: 1, content: document.content });
      await connection.sendNotification('textDocument/didOpen', {
        textDocument: {
          uri,
          languageId: document.languageId,
          version: 1,
          text: document.content,
        },
      });
    } else if (opened.content !== document.content) {
      const version = opened.version + 1;
      openDocuments.set(uri, { version, content: document.content });
      await connection.sendNotification('textDocument/didChange', {
        textDocument: { uri, version },
        contentChanges: [{ text: document.content }],
      });
    }
    return uri;
  };

  return {
    async definition(document, position) {
      const uri = await syncDocument(document);
      return toRawLocations(
        await request<DefinitionResult>('textDocument/definition', {
          textDocument: { uri },
          position,
        }),
      );
    },
    async references(document, position) {
      const uri = await syncDocument(document);
      return toRawLocations(
        await request<DefinitionResult>('textDocument/references', {
          textDocument: { uri },
          position,
          context: { includeDeclaration: true },
        }),
      );
    },
    onExit(listener) {
      if (exitDetail !== undefined) {
        listener(exitDetail);
        return;
      }
      exitListeners.push(listener);
    },
    async shutdown() {
      if (exitDetail === undefined) {
        await request('shutdown', null, SHUTDOWN_TIMEOUT_MS)
          .then(() => connection.sendNotification('exit'))
          .then(() => withTimeout(exited, 'exit', SHUTDOWN_TIMEOUT_MS))
          .catch(() => undefined);
      }
      kill();
    },
    kill,
  };
}
