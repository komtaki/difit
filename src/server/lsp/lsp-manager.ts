import { realpathSync } from 'fs';
import { readFile } from 'fs/promises';
import { isAbsolute, relative, resolve, sep } from 'path';
import { fileURLToPath } from 'url';

import type {
  LspLanguage,
  LspLocation,
  LspPositionRequest,
  LspServerState,
  LspServerStatus,
} from '../../types/lsp.js';

import {
  detectLanguage,
  getLanguageId,
  LSP_LANGUAGES,
  resolveServerCommand,
} from './language-servers.js';
import { startLspClient, type LspClient, type LspRawLocation } from './lsp-client.js';

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRY_COOLDOWN_MS = 30_000;
const PREVIEW_CONTEXT_LINES = 3;

export class LspUnsupportedFileError extends Error {
  constructor(filePath: string) {
    super(`No language server handles ${filePath}`);
    this.name = 'LspUnsupportedFileError';
  }
}

export class LspUnavailableError extends Error {
  constructor(language: LspLanguage, detail: string | undefined) {
    super(`The ${language} language server is unavailable${detail ? `: ${detail}` : ''}`);
    this.name = 'LspUnavailableError';
  }
}

interface ServerEntry {
  state: LspServerState;
  detail?: string;
  client?: Promise<LspClient>;
  retryAfter?: number;
}

interface LspManagerOptions {
  repoPath: string;
  isInDiff: (filePath: string) => boolean;
  timeoutMs?: number;
  retryCooldownMs?: number;
  resolveCommand?: (language: LspLanguage) => { command: string; args: string[] };
}

function toRepositoryPath(absolutePath: string, repositoryRoots: string[]): string | null {
  for (const root of repositoryRoots) {
    const relativePath = relative(root, absolutePath);
    const isInside =
      relativePath.length > 0 &&
      relativePath !== '..' &&
      !relativePath.startsWith(`..${sep}`) &&
      !isAbsolute(relativePath);
    if (isInside) {
      return relativePath.split(sep).join('/');
    }
  }
  return null;
}

function resolveRealPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

export function createLspManager(options: LspManagerOptions) {
  const repoPath = resolve(options.repoPath);
  const repositoryRoots = [...new Set([repoPath, resolveRealPath(repoPath)])];
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retryCooldownMs = options.retryCooldownMs ?? DEFAULT_RETRY_COOLDOWN_MS;
  const resolveCommand =
    options.resolveCommand ?? ((language: LspLanguage) => resolveServerCommand(language, repoPath));
  const createIdleServers = (): Record<LspLanguage, ServerEntry> => ({
    ruby: { state: 'idle' },
    typescript: { state: 'idle' },
    python: { state: 'idle' },
  });
  let servers = createIdleServers();
  const startedClients = new Set<Promise<LspClient>>();
  const runningClients = new Set<LspClient>();
  const killAll = () => {
    for (const client of runningClients) {
      client.kill();
    }
  };

  const markUnavailable = (language: LspLanguage, detail: string) => {
    servers[language] = { state: 'unavailable', detail, retryAfter: Date.now() + retryCooldownMs };
  };

  const getClient = (language: LspLanguage): Promise<LspClient> => {
    const entry = servers[language];
    if (entry.retryAfter !== undefined && Date.now() < entry.retryAfter) {
      return Promise.reject(new LspUnavailableError(language, entry.detail));
    }
    if (entry.client) {
      return entry.client;
    }

    if (startedClients.size === 0) {
      process.once('exit', killAll);
    }
    const { command, args } = resolveCommand(language);
    const client = startLspClient({ command, args, rootPath: repoPath, timeoutMs }).then(
      (startedClient) => {
        if (servers[language].client !== client) {
          return startedClient;
        }
        servers[language] = { state: 'ready', client };
        runningClients.add(startedClient);
        startedClient.onExit((detail) => {
          runningClients.delete(startedClient);
          if (servers[language].client === client) {
            markUnavailable(language, detail);
          }
        });
        return startedClient;
      },
      (error: unknown) => {
        const detail = error instanceof Error ? error.message : String(error);
        if (servers[language].client === client) {
          markUnavailable(language, detail);
        }
        throw new LspUnavailableError(language, detail);
      },
    );
    servers[language] = { state: 'starting', client };
    startedClients.add(client);
    return client;
  };

  const readLines = async (absolutePath: string): Promise<string[] | null> => {
    try {
      return (await readFile(absolutePath, 'utf8')).split('\n');
    } catch {
      return null;
    }
  };

  const toLocation = async (
    rawLocation: LspRawLocation,
    readCachedLines: (absolutePath: string) => Promise<string[] | null>,
  ): Promise<LspLocation> => {
    const absolutePath = rawLocation.uri.startsWith('file:')
      ? fileURLToPath(rawLocation.uri)
      : rawLocation.uri;
    const repositoryPath = toRepositoryPath(absolutePath, repositoryRoots);
    const line = rawLocation.line + 1;
    const lines = await readCachedLines(absolutePath);
    const previewStartLine = lines ? Math.max(1, line - PREVIEW_CONTEXT_LINES) : line;
    const previewEndLine = Math.min(lines?.length ?? 0, line + PREVIEW_CONTEXT_LINES);

    return {
      filePath: repositoryPath ?? absolutePath,
      line,
      character: rawLocation.character,
      inDiff: repositoryPath !== null && options.isInDiff(repositoryPath),
      preview: lines?.slice(previewStartLine - 1, previewEndLine) ?? [],
      previewStartLine,
    };
  };

  const lookup = async (
    method: 'definition' | 'references',
    request: LspPositionRequest,
  ): Promise<LspLocation[]> => {
    const language = detectLanguage(request.filePath);
    if (!language) {
      throw new LspUnsupportedFileError(request.filePath);
    }

    const absolutePath = resolve(repoPath, request.filePath);
    const content = await readFile(absolutePath, 'utf8');
    const client = await getClient(language);
    let rawLocations: LspRawLocation[];
    try {
      rawLocations = await client[method](
        { absolutePath, languageId: getLanguageId(request.filePath), content },
        { line: request.line - 1, character: request.character },
      );
    } catch (error) {
      const entry = servers[language];
      if (entry.state === 'unavailable') {
        throw new LspUnavailableError(language, entry.detail);
      }
      throw error;
    }

    const linesByPath = new Map<string, Promise<string[] | null>>();
    const readCachedLines = (path: string) => {
      const cached = linesByPath.get(path) ?? readLines(path);
      linesByPath.set(path, cached);
      return cached;
    };
    return Promise.all(rawLocations.map((location) => toLocation(location, readCachedLines)));
  };

  return {
    status(): LspServerStatus[] {
      return LSP_LANGUAGES.map((language) => {
        const { state, detail } = servers[language];
        return detail ? { language, state, detail } : { language, state };
      });
    },
    definition: (request: LspPositionRequest) => lookup('definition', request),
    references: (request: LspPositionRequest) => lookup('references', request),
    async shutdown(): Promise<void> {
      const clients = [...startedClients];
      startedClients.clear();
      servers = createIdleServers();
      process.removeListener('exit', killAll);
      await Promise.all(
        clients.map((client) =>
          client.then(
            (startedClient) => startedClient.shutdown(),
            () => undefined,
          ),
        ),
      );
    },
  };
}
