import { execFileSync } from 'child_process';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDecisionStore, type DecisionRecord } from '../server/decision-store.js';

import { createDecisionsCommand } from './decision-commands.js';

const record: DecisionRecord = {
  decision: 'rejected',
  reviewer: 'correctness',
  filePath: 'src/a.ts',
  title: 'Null check',
  decidedAt: '2024-01-01T00:00:00.000Z',
};

describe('decisions command', () => {
  let repoPath: string;
  let originalProcessExit: typeof process.exit;
  let consoleOutput: string[];
  let consoleErrors: string[];

  async function run(...args: string[]) {
    await createDecisionsCommand(repoPath).parseAsync(['node', 'difit', ...args]);
  }

  beforeEach(async () => {
    repoPath = await fs.mkdtemp(join(tmpdir(), 'difit-decision-commands-'));
    execFileSync('git', ['init', '--quiet', '-b', 'feature/x'], { cwd: repoPath });

    originalProcessExit = process.exit;
    process.exit = vi.fn() as any;
    consoleOutput = [];
    consoleErrors = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      consoleOutput.push(args.join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      consoleErrors.push(args.join(' '));
    });
  });

  afterEach(async () => {
    process.exit = originalProcessExit;
    vi.restoreAllMocks();
    await fs.rm(repoPath, { recursive: true, force: true });
  });

  it('prints the decisions of the current branch as JSON', async () => {
    const store = await createDecisionStore({ repoPath });
    await store!.set('fp-1', record);

    await run('get');

    expect(JSON.parse(consoleOutput[0]!)).toEqual({ 'fp-1': record });
  });

  it('reads another branch with --branch', async () => {
    const store = await createDecisionStore({ repoPath, branch: 'main' });
    await store!.set('fp-2', record);

    await run('get', '--branch', 'main');
    await run('get');

    expect(JSON.parse(consoleOutput[0]!)).toEqual({ 'fp-2': record });
    expect(JSON.parse(consoleOutput[1]!)).toEqual({});
  });

  it('clears the decisions of a branch', async () => {
    const store = await createDecisionStore({ repoPath });
    await store!.set('fp-1', record);

    await run('clear');

    expect(JSON.parse(consoleOutput[0]!)).toEqual({ success: true });
    const reloaded = await createDecisionStore({ repoPath });
    expect(reloaded!.all()).toEqual({});
  });

  it('fails when the branch cannot be determined', async () => {
    const directory = await fs.mkdtemp(join(tmpdir(), 'difit-no-repo-'));
    try {
      await createDecisionsCommand(directory).parseAsync(['node', 'difit', 'get']);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }

    expect(consoleErrors[0]).toBe(
      'Error: Cannot determine the branch to store decisions for. Run inside a git repository on a branch or pass --branch.',
    );
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});
