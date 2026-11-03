import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { delimiter, join } from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { detectLanguage, getLanguageId, resolveServerCommand } from './language-servers.js';

describe('detectLanguage', () => {
  it.each([
    ['app/models/user.rb', 'ruby'],
    ['lib/tasks/db.rake', 'ruby'],
    ['difit.gemspec', 'ruby'],
    ['src/a.ts', 'typescript'],
    ['src/App.tsx', 'typescript'],
    ['src/a.js', 'typescript'],
    ['src/a.jsx', 'typescript'],
    ['src/a.mts', 'typescript'],
    ['src/a.cts', 'typescript'],
    ['src/a.mjs', 'typescript'],
    ['src/a.cjs', 'typescript'],
    ['tool/main.py', 'python'],
    ['stubs/main.pyi', 'python'],
  ])('detects %s as %s', (filePath, language) => {
    expect(detectLanguage(filePath)).toBe(language);
  });

  it.each(['README.md', 'Gemfile', 'src/a.d', 'Makefile'])('returns null for %s', (filePath) => {
    expect(detectLanguage(filePath)).toBeNull();
  });
});

describe('getLanguageId', () => {
  it.each([
    ['a.rb', 'ruby'],
    ['a.ts', 'typescript'],
    ['a.mts', 'typescript'],
    ['a.tsx', 'typescriptreact'],
    ['a.js', 'javascript'],
    ['a.cjs', 'javascript'],
    ['a.jsx', 'javascriptreact'],
    ['a.py', 'python'],
  ])('maps %s to %s', (filePath, languageId) => {
    expect(getLanguageId(filePath)).toBe(languageId);
  });
});

describe('resolveServerCommand', () => {
  let repoPath: string;
  let binPath: string;
  const originalPath = process.env.PATH;

  async function addExecutable(directory: string, name: string) {
    await fs.mkdir(directory, { recursive: true });
    const filePath = join(directory, name);
    await fs.writeFile(filePath, '#!/bin/sh\n');
    await fs.chmod(filePath, 0o755);
    return filePath;
  }

  beforeEach(async () => {
    repoPath = await fs.mkdtemp(join(tmpdir(), 'difit-lsp-repo-'));
    binPath = await fs.mkdtemp(join(tmpdir(), 'difit-lsp-bin-'));
    process.env.PATH = binPath;
  });

  afterEach(async () => {
    process.env.PATH = originalPath;
    await fs.rm(repoPath, { recursive: true, force: true });
    await fs.rm(binPath, { recursive: true, force: true });
  });

  it.each([
    ['ruby', 'ruby-lsp', []],
    ['typescript', 'typescript-language-server', ['--stdio']],
    ['python', 'pyright-langserver', ['--stdio']],
  ] as const)('starts %s with %s', (language, command, args) => {
    expect(resolveServerCommand(language, repoPath)).toEqual({ command, args });
  });

  it('prefers the repository typescript-language-server', async () => {
    const localBinary = await addExecutable(
      join(repoPath, 'node_modules', '.bin'),
      'typescript-language-server',
    );

    expect(resolveServerCommand('typescript', repoPath)).toEqual({
      command: localBinary,
      args: ['--stdio'],
    });
  });

  it('runs through mise when the repository pins tools with mise.toml', async () => {
    await fs.writeFile(join(repoPath, 'mise.toml'), '[tools]\n');
    await addExecutable(binPath, 'mise');

    expect(resolveServerCommand('ruby', repoPath)).toEqual({
      command: 'mise',
      args: ['x', '--', 'ruby-lsp'],
    });
  });

  it('does not use mise when it is not on PATH', async () => {
    await fs.writeFile(join(repoPath, 'mise.toml'), '[tools]\n');
    process.env.PATH = [binPath, join(binPath, 'missing')].join(delimiter);

    expect(resolveServerCommand('ruby', repoPath)).toEqual({ command: 'ruby-lsp', args: [] });
  });
});
