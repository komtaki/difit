import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createLspManager, LspUnavailableError, LspUnsupportedFileError } from './lsp-manager.js';

const fakeServerPath = join(import.meta.dirname, 'fixtures', 'fake-language-server.mjs');

describe('createLspManager', () => {
  let repoPath: string;
  let manager: ReturnType<typeof createLspManager>;

  function setup(command: string = process.execPath, timeoutMs = 2000) {
    manager = createLspManager({
      repoPath,
      timeoutMs,
      resolveCommand: () => ({
        command,
        args: command === process.execPath ? [fakeServerPath] : [],
      }),
      isInDiff: (filePath) => filePath === 'src/a.ts',
    });
  }

  beforeEach(async () => {
    repoPath = await fs.mkdtemp(join(tmpdir(), 'difit-lsp-manager-'));
    await fs.mkdir(join(repoPath, 'src'));
    await fs.writeFile(
      join(repoPath, 'src', 'a.ts'),
      Array.from({ length: 10 }, (_, index) => `line ${index + 1}`).join('\n'),
    );
    delete process.env.FAKE_LSP_MODE;
  });

  afterEach(async () => {
    await manager.shutdown();
    delete process.env.FAKE_LSP_MODE;
    await fs.rm(repoPath, { recursive: true, force: true });
  });

  it('starts servers lazily and reports their state', async () => {
    setup();
    expect(manager.status()).toEqual([
      { language: 'ruby', state: 'idle' },
      { language: 'typescript', state: 'idle' },
      { language: 'python', state: 'idle' },
    ]);

    await manager.definition({ filePath: 'src/a.ts', line: 2, character: 3 });

    expect(manager.status()).toContainEqual({ language: 'typescript', state: 'ready' });
    expect(manager.status()).toContainEqual({ language: 'ruby', state: 'idle' });
  });

  it('converts definitions to 1-based repository locations with a preview', async () => {
    setup();

    const locations = await manager.definition({ filePath: 'src/a.ts', line: 2, character: 3 });

    expect(locations).toEqual([
      {
        filePath: 'src/a.ts',
        line: 2,
        character: 9,
        inDiff: true,
        preview: ['line 1', 'line 2', 'line 3', 'line 4', 'line 5'],
        previewStartLine: 1,
      },
    ]);
  });

  it('keeps locations outside the repository as absolute paths', async () => {
    setup();

    const locations = await manager.references({ filePath: 'src/a.ts', line: 7, character: 1 });

    expect(locations[0]).toMatchObject({
      filePath: 'src/a.ts',
      line: 7,
      character: 1,
      inDiff: true,
      preview: ['line 4', 'line 5', 'line 6', 'line 7', 'line 8', 'line 9', 'line 10'],
      previewStartLine: 4,
    });
    expect(locations[1]).toEqual({
      filePath: '/outside/repository/types.d.ts',
      line: 5,
      character: 2,
      inDiff: false,
      preview: [],
      previewStartLine: 5,
    });
  });

  it('rejects files no language server handles', async () => {
    setup();
    await fs.writeFile(join(repoPath, 'README.md'), '# hi');

    await expect(
      manager.definition({ filePath: 'README.md', line: 1, character: 0 }),
    ).rejects.toBeInstanceOf(LspUnsupportedFileError);
  });

  it('marks a server that cannot start as unavailable with the error', async () => {
    setup(join(repoPath, 'missing-language-server'));

    await expect(
      manager.definition({ filePath: 'src/a.ts', line: 1, character: 0 }),
    ).rejects.toBeInstanceOf(LspUnavailableError);

    const typescript = manager.status().find((server) => server.language === 'typescript');
    expect(typescript?.state).toBe('unavailable');
    expect(typescript?.detail).toMatch(/ENOENT/);
  });

  it('marks a server that crashes as unavailable with its stderr', async () => {
    process.env.FAKE_LSP_MODE = 'crash';
    setup();

    await expect(
      manager.definition({ filePath: 'src/a.ts', line: 1, character: 0 }),
    ).rejects.toBeInstanceOf(LspUnavailableError);

    const typescript = manager.status().find((server) => server.language === 'typescript');
    expect(typescript).toMatchObject({ state: 'unavailable' });
    expect(typescript?.detail).toContain('fatal: cannot start');
  });

  it('shares a single server start between concurrent requests', async () => {
    setup();

    const [definition, references] = await Promise.all([
      manager.definition({ filePath: 'src/a.ts', line: 2, character: 3 }),
      manager.references({ filePath: 'src/a.ts', line: 2, character: 3 }),
    ]);

    expect(definition).toHaveLength(1);
    expect(references).toHaveLength(2);
  });

  it('returns to idle after shutdown', async () => {
    setup();
    await manager.definition({ filePath: 'src/a.ts', line: 2, character: 3 });

    await manager.shutdown();

    expect(manager.status()).toContainEqual({ language: 'typescript', state: 'idle' });
  });
});
