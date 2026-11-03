import { accessSync, constants, existsSync } from 'fs';
import { delimiter, extname, join } from 'path';

import type { LspLanguage } from '../../types/lsp.js';

export const LSP_LANGUAGES: readonly LspLanguage[] = ['ruby', 'typescript', 'python'];

const LANGUAGE_IDS_BY_EXTENSION: Record<string, { language: LspLanguage; languageId: string }> = {
  '.rb': { language: 'ruby', languageId: 'ruby' },
  '.rake': { language: 'ruby', languageId: 'ruby' },
  '.gemspec': { language: 'ruby', languageId: 'ruby' },
  '.ts': { language: 'typescript', languageId: 'typescript' },
  '.mts': { language: 'typescript', languageId: 'typescript' },
  '.cts': { language: 'typescript', languageId: 'typescript' },
  '.tsx': { language: 'typescript', languageId: 'typescriptreact' },
  '.js': { language: 'typescript', languageId: 'javascript' },
  '.mjs': { language: 'typescript', languageId: 'javascript' },
  '.cjs': { language: 'typescript', languageId: 'javascript' },
  '.jsx': { language: 'typescript', languageId: 'javascriptreact' },
  '.py': { language: 'python', languageId: 'python' },
  '.pyi': { language: 'python', languageId: 'python' },
};

const SERVER_COMMANDS: Record<LspLanguage, { command: string; args: string[] }> = {
  ruby: { command: 'ruby-lsp', args: [] },
  typescript: { command: 'typescript-language-server', args: ['--stdio'] },
  python: { command: 'pyright-langserver', args: ['--stdio'] },
};

export function detectLanguage(filePath: string): LspLanguage | null {
  return LANGUAGE_IDS_BY_EXTENSION[extname(filePath).toLowerCase()]?.language ?? null;
}

export function getLanguageId(filePath: string): string {
  return LANGUAGE_IDS_BY_EXTENSION[extname(filePath).toLowerCase()]?.languageId ?? 'plaintext';
}

function isExecutable(filePath: string): boolean {
  try {
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function isOnPath(command: string): boolean {
  return (process.env.PATH ?? '')
    .split(delimiter)
    .some((directory) => directory.length > 0 && isExecutable(join(directory, command)));
}

export function resolveServerCommand(
  language: LspLanguage,
  repoPath: string,
): { command: string; args: string[] } {
  const { command, args } = SERVER_COMMANDS[language];
  const localBinary = join(repoPath, 'node_modules', '.bin', command);
  const resolvedCommand =
    language === 'typescript' && isExecutable(localBinary) ? localBinary : command;

  if (existsSync(join(repoPath, 'mise.toml')) && isOnPath('mise')) {
    return { command: 'mise', args: ['x', '--', resolvedCommand, ...args] };
  }

  return { command: resolvedCommand, args: [...args] };
}
