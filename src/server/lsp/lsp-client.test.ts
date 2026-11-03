import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LspRequestTimeoutError, startLspClient, type LspClient } from './lsp-client.js';

const fakeServerPath = join(import.meta.dirname, 'fixtures', 'fake-language-server.mjs');

describe('startLspClient', () => {
  let rootPath: string;
  let logPath: string;
  let client: LspClient | undefined;
  const originalMode = process.env.FAKE_LSP_MODE;

  const document = () => ({
    absolutePath: join(rootPath, 'src', 'a.ts'),
    languageId: 'typescript',
    content: 'const a = 1;\nexport function hello() {}\n',
  });

  async function readLog(): Promise<Array<{ method: string; params: any }>> {
    const raw = await fs.readFile(logPath, 'utf8');
    return raw
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { method: string; params: any });
  }

  function start(timeoutMs = 2000) {
    return startLspClient({
      command: process.execPath,
      args: [fakeServerPath],
      rootPath,
      timeoutMs,
    });
  }

  beforeEach(async () => {
    rootPath = await fs.mkdtemp(join(tmpdir(), 'difit-lsp-client-'));
    logPath = join(rootPath, 'lsp.log');
    process.env.FAKE_LSP_LOG = logPath;
    delete process.env.FAKE_LSP_MODE;
  });

  afterEach(async () => {
    client?.kill();
    client = undefined;
    delete process.env.FAKE_LSP_LOG;
    if (originalMode === undefined) {
      delete process.env.FAKE_LSP_MODE;
    } else {
      process.env.FAKE_LSP_MODE = originalMode;
    }
    await fs.rm(rootPath, { recursive: true, force: true });
  });

  it('initializes with the repository root and opens the document before asking', async () => {
    client = await start();

    const locations = await client.definition(document(), { line: 1, character: 17 });

    expect(locations).toEqual([
      { uri: pathToFileURL(document().absolutePath).href, line: 1, character: 9 },
    ]);
    const log = await readLog();
    expect(log.map((entry) => entry.method)).toEqual([
      'initialize',
      'initialized',
      'textDocument/didOpen',
      'textDocument/definition',
    ]);
    expect(log[0]!.params.rootUri).toBe(pathToFileURL(rootPath).href);
    expect(log[2]!.params.textDocument).toMatchObject({
      languageId: 'typescript',
      text: document().content,
    });
  });

  it('returns plain locations for references and syncs changed content', async () => {
    client = await start();
    await client.references(document(), { line: 0, character: 6 });

    const changed = { ...document(), content: 'const b = 2;\n' };
    const locations = await client.references(changed, { line: 0, character: 6 });

    expect(locations).toEqual([
      { uri: pathToFileURL(changed.absolutePath).href, line: 0, character: 6 },
      { uri: 'file:///outside/repository/types.d.ts', line: 4, character: 2 },
    ]);
    const methods = (await readLog()).map((entry) => entry.method);
    expect(methods.filter((method) => method === 'textDocument/didOpen')).toHaveLength(1);
    expect(methods).toContain('textDocument/didChange');
    const references = (await readLog()).find(
      (entry) => entry.method === 'textDocument/references',
    );
    expect(references?.params.context).toEqual({ includeDeclaration: true });
  });

  it('times out a request the server never answers', async () => {
    process.env.FAKE_LSP_MODE = 'hang';
    client = await start(200);

    await expect(client.definition(document(), { line: 0, character: 0 })).rejects.toBeInstanceOf(
      LspRequestTimeoutError,
    );
  });

  it('fails to start when the command does not exist', async () => {
    await expect(
      startLspClient({
        command: join(rootPath, 'missing-language-server'),
        args: [],
        rootPath,
        timeoutMs: 2000,
      }),
    ).rejects.toThrow(/ENOENT/);
  });

  it('reports stderr when the server exits during startup', async () => {
    process.env.FAKE_LSP_MODE = 'crash';

    await expect(start()).rejects.toThrow(/fatal: cannot start/);
  });

  it('sends shutdown and exit, then reports the exit', async () => {
    client = await start();
    const exited = new Promise<string>((resolve) => client!.onExit(resolve));

    await client.shutdown();

    expect((await readLog()).map((entry) => entry.method).slice(-2)).toEqual(['shutdown', 'exit']);
    await expect(exited).resolves.toContain('exited');
  });
});
