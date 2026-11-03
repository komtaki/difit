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
const REQUEST_RESERVE_MS = 2000;
const SELF_LOCATION_RETRY_DELAYS_MS = [250, 500, 1000];

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

interface LspRangeLocation {
  uri: string;
  range: LspRange;
}

function toRangeLocations(result: DefinitionResult): LspRangeLocation[] {
  if (!result) {
    return [];
  }

  return (Array.isArray(result) ? result : [result]).map((location) => {
    if ('targetUri' in location) {
      return {
        uri: location.targetUri,
        range: location.targetSelectionRange ?? location.targetRange,
      };
    }
    return location;
  });
}

function toRawLocations(locations: LspRangeLocation[]): LspRawLocation[] {
  return locations.map(({ uri, range }) => ({ uri, ...range.start }));
}

function isBefore(a: LspPosition, b: LspPosition): boolean {
  return a.line < b.line || (a.line === b.line && a.character < b.character);
}

function isOnlyRequestPosition(
  locations: LspRangeLocation[],
  uri: string,
  position: LspPosition,
): boolean {
  return (
    locations.length > 0 &&
    locations.every(
      (location) =>
        location.uri === uri &&
        !isBefore(position, location.range.start) &&
        !isBefore(location.range.end, position),
    )
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  const activeProgressTokens = new Set<string | number>();
  const idleWaiters = new Set<() => void>();
  const settleProgress = (token: string | number) => {
    activeProgressTokens.delete(token);
    if (activeProgressTokens.size > 0) {
      return;
    }
    for (const resolveIdle of idleWaiters) {
      resolveIdle();
    }
    idleWaiters.clear();
  };
  connection.onRequest('window/workDoneProgress/create', (params: { token: string | number }) => {
    activeProgressTokens.add(params.token);
    return null;
  });
  connection.onUnhandledProgress(({ token, value }) => {
    const kind = (value as { kind?: string } | null)?.kind;
    if (kind === 'begin') {
      activeProgressTokens.add(token);
    } else if (kind === 'end') {
      settleProgress(token);
    }
  });
  connection.onError(() => {});
  connection.listen();

  const requestReserveMs = Math.min(REQUEST_RESERVE_MS, options.timeoutMs / 2);
  const waitForIdleProgress = async (budgetMs: number) => {
    if (activeProgressTokens.size === 0 || budgetMs <= 0) {
      return;
    }
    let resolveIdle = () => {};
    const idle = new Promise<void>((resolve) => {
      resolveIdle = resolve;
      idleWaiters.add(resolve);
    });
    await Promise.race([idle, delay(budgetMs), exited]);
    idleWaiters.delete(resolveIdle);
  };

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
        window: { workDoneProgress: true },
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

  const requestWhenIdle = async (
    method: string,
    params: unknown,
    deadline: number,
  ): Promise<LspRangeLocation[]> => {
    await waitForIdleProgress(deadline - Date.now() - requestReserveMs);
    return toRangeLocations(
      await request<DefinitionResult>(method, params, Math.max(1, deadline - Date.now())),
    );
  };

  let hasResolvedDefinitionElsewhere = false;

  return {
    async definition(document, position) {
      const deadline = Date.now() + options.timeoutMs;
      const uri = await syncDocument(document);
      const params = { textDocument: { uri }, position };
      let locations = await requestWhenIdle('textDocument/definition', params, deadline);
      for (const retryDelayMs of SELF_LOCATION_RETRY_DELAYS_MS) {
        if (
          hasResolvedDefinitionElsewhere ||
          !isOnlyRequestPosition(locations, uri, position) ||
          Date.now() + retryDelayMs + requestReserveMs > deadline
        ) {
          break;
        }
        await delay(retryDelayMs);
        try {
          locations = await requestWhenIdle('textDocument/definition', params, deadline);
        } catch (error) {
          if (error instanceof LspRequestTimeoutError) {
            break;
          }
          throw error;
        }
      }
      if (locations.length > 0 && !isOnlyRequestPosition(locations, uri, position)) {
        hasResolvedDefinitionElsewhere = true;
      }
      return toRawLocations(locations);
    },
    async references(document, position) {
      const deadline = Date.now() + options.timeoutMs;
      const uri = await syncDocument(document);
      return toRawLocations(
        await requestWhenIdle(
          'textDocument/references',
          { textDocument: { uri }, position, context: { includeDeclaration: true } },
          deadline,
        ),
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
