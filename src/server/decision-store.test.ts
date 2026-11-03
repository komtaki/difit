import { execFileSync } from 'child_process';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DiffCommentThread, FindingMeta } from '../types/diff.js';

import {
  computeFindingFingerprint,
  createDecisionStore,
  type DecisionRecord,
  InvalidBranchNameError,
  syncFindingDecisions,
} from './decision-store.js';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf8',
  }).trim();
}

async function createRepository(branch = 'main'): Promise<string> {
  const repoPath = await fs.mkdtemp(join(tmpdir(), 'difit-decisions-'));
  git(repoPath, 'init', '--quiet', '-b', branch);
  git(
    repoPath,
    '-c',
    'user.name=difit',
    '-c',
    'user.email=difit@example.com',
    'commit',
    '--quiet',
    '--allow-empty',
    '-m',
    'initial',
  );
  return repoPath;
}

function findingThread(id: string, finding: Partial<FindingMeta>): DiffCommentThread {
  return {
    id,
    filePath: 'src/a.ts',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    position: { side: 'new', line: 3 },
    messages: [
      {
        id,
        body: 'finding body',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      },
    ],
    kind: 'finding',
    finding: {
      reviewer: 'correctness',
      severity: 'warn',
      title: 'Null check',
      fingerprint: 'fp-1',
      ...finding,
    },
  };
}

const rejectedRecord: DecisionRecord = {
  decision: 'rejected',
  reviewer: 'correctness',
  filePath: 'src/a.ts',
  title: 'Null check',
  decidedAt: '2024-01-01T00:00:00.000Z',
};

describe('computeFindingFingerprint', () => {
  const base = {
    reviewer: 'correctness',
    filePath: 'src/a.ts',
    title: 'Null check',
    lineContent: '  return value.name;',
  };

  it('ignores surrounding whitespace of the flagged code', () => {
    expect(computeFindingFingerprint(base)).toBe(
      computeFindingFingerprint({ ...base, lineContent: 'return value.name;\n' }),
    );
  });

  it('changes when any identifying field changes', () => {
    const fingerprint = computeFindingFingerprint(base);
    expect(computeFindingFingerprint({ ...base, reviewer: 'security' })).not.toBe(fingerprint);
    expect(computeFindingFingerprint({ ...base, filePath: 'src/b.ts' })).not.toBe(fingerprint);
    expect(computeFindingFingerprint({ ...base, title: 'Other' })).not.toBe(fingerprint);
    expect(computeFindingFingerprint({ ...base, lineContent: 'return 1;' })).not.toBe(fingerprint);
  });

  it('does not let a field boundary shift produce the same fingerprint', () => {
    expect(computeFindingFingerprint({ ...base, reviewer: 'ab', filePath: 'c' })).not.toBe(
      computeFindingFingerprint({ ...base, reviewer: 'a', filePath: 'bc' }),
    );
  });

  it('prefers the import id when present', () => {
    expect(computeFindingFingerprint({ ...base, id: 'finding-1' })).toBe('id:finding-1');
  });
});

describe('createDecisionStore', () => {
  const repositories: string[] = [];

  async function setupRepository(branch?: string): Promise<string> {
    const repoPath = await createRepository(branch);
    repositories.push(repoPath);
    return repoPath;
  }

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const repoPath of repositories.splice(0)) {
      await fs.rm(repoPath, { recursive: true, force: true });
    }
  });

  it('stores decisions under the git common dir per branch', async () => {
    const repoPath = await setupRepository('feature/login');
    const store = await createDecisionStore({ repoPath });

    expect(store).not.toBeNull();
    await store!.set('fp-1', rejectedRecord);

    const commonDir = await fs.realpath(join(repoPath, '.git'));
    expect(await fs.realpath(store!.filePath)).toBe(
      join(commonDir, 'difit', 'decisions', 'feature', 'login.json'),
    );

    const reloaded = await createDecisionStore({ repoPath });
    expect(reloaded!.get('fp-1')).toEqual(rejectedRecord);
    expect(JSON.parse(await fs.readFile(store!.filePath, 'utf8'))).toEqual({
      'fp-1': rejectedRecord,
    });
  });

  it('uses the given branch instead of the current one', async () => {
    const repoPath = await setupRepository();
    const store = await createDecisionStore({ repoPath, branch: 'other' });

    expect(store!.filePath.endsWith(join('decisions', 'other.json'))).toBe(true);
  });

  it.each(['../../config', 'a/../b', '/tmp/x', '.hidden'])(
    'rejects the invalid branch name %s',
    async (branch) => {
      const repoPath = await setupRepository();

      await expect(createDecisionStore({ repoPath, branch })).rejects.toThrow(
        new InvalidBranchNameError(branch),
      );
    },
  );

  it('returns null on a detached HEAD', async () => {
    const repoPath = await setupRepository();
    git(repoPath, 'checkout', '--quiet', '--detach');

    expect(await createDecisionStore({ repoPath })).toBeNull();
  });

  it('returns null outside a git repository', async () => {
    const directory = await fs.mkdtemp(join(tmpdir(), 'difit-no-repo-'));
    repositories.push(directory);

    expect(await createDecisionStore({ repoPath: directory })).toBeNull();
  });

  it('treats a broken decisions file as empty and warns', async () => {
    const repoPath = await setupRepository();
    const store = await createDecisionStore({ repoPath });
    await fs.mkdir(join(store!.filePath, '..'), { recursive: true });
    await fs.writeFile(store!.filePath, '{ not json');

    const reloaded = await createDecisionStore({ repoPath });

    expect(reloaded!.all()).toEqual({});
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining(store!.filePath));
  });

  it('deletes and clears decisions', async () => {
    const repoPath = await setupRepository();
    const store = await createDecisionStore({ repoPath });
    await store!.set('fp-1', rejectedRecord);
    await store!.set('fp-2', { ...rejectedRecord, decision: 'adopted' });

    await store!.delete('fp-1');
    expect(Object.keys(store!.all())).toEqual(['fp-2']);

    await store!.clear();
    expect(store!.all()).toEqual({});
    const reloaded = await createDecisionStore({ repoPath });
    expect(reloaded!.all()).toEqual({});
  });

  it('keeps every write when decisions are saved concurrently', async () => {
    const repoPath = await setupRepository();
    const store = await createDecisionStore({ repoPath });

    await Promise.all([
      store!.set('fp-1', rejectedRecord),
      store!.set('fp-2', rejectedRecord),
      store!.set('fp-3', rejectedRecord),
    ]);

    const reloaded = await createDecisionStore({ repoPath });
    expect(Object.keys(reloaded!.all()).sort()).toEqual(['fp-1', 'fp-2', 'fp-3']);
  });

  it('does not resurrect decisions cleared by another process', async () => {
    const repoPath = await setupRepository();
    const store = await createDecisionStore({ repoPath });
    await store!.set('fp-1', rejectedRecord);

    await (await createDecisionStore({ repoPath }))!.clear();
    await store!.set('fp-2', rejectedRecord);

    const reloaded = await createDecisionStore({ repoPath });
    expect(Object.keys(reloaded!.all())).toEqual(['fp-2']);
  });

  it('keeps decisions saved by another store on the same branch', async () => {
    const repoPath = await setupRepository();
    const first = await createDecisionStore({ repoPath });
    const second = await createDecisionStore({ repoPath });

    await first!.set('fp-1', rejectedRecord);
    await second!.set('fp-2', rejectedRecord);
    await first!.delete('fp-3');

    const reloaded = await createDecisionStore({ repoPath });
    expect(Object.keys(reloaded!.all()).sort()).toEqual(['fp-1', 'fp-2']);
  });
});

describe('syncFindingDecisions', () => {
  function createMemoryStore(initial: Record<string, DecisionRecord> = {}) {
    const records = new Map(Object.entries(initial));
    return {
      filePath: 'memory',
      get: (fingerprint: string) => records.get(fingerprint),
      set: vi.fn(async (fingerprint: string, record: DecisionRecord) => {
        records.set(fingerprint, record);
      }),
      delete: vi.fn(async (fingerprint: string) => {
        records.delete(fingerprint);
      }),
      all: () => Object.fromEntries(records),
      clear: vi.fn(async () => records.clear()),
    };
  }

  it('records a new decision with the finding identity', async () => {
    const store = createMemoryStore();

    await syncFindingDecisions(
      store,
      [findingThread('t1', {})],
      [findingThread('t1', { decision: 'rejected' })],
    );

    expect(store.get('fp-1')).toEqual({
      decision: 'rejected',
      reviewer: 'correctness',
      filePath: 'src/a.ts',
      title: 'Null check',
      decidedAt: expect.any(String),
    });
  });

  it('removes the record when a decision is withdrawn', async () => {
    const store = createMemoryStore({ 'fp-1': rejectedRecord });

    await syncFindingDecisions(
      store,
      [findingThread('t1', { decision: 'rejected' })],
      [findingThread('t1', {})],
    );

    expect(store.get('fp-1')).toBeUndefined();
  });

  it('keeps a previous-round record for an undecided finding', async () => {
    const store = createMemoryStore({ 'fp-1': { ...rejectedRecord, decision: 'adopted' } });

    await syncFindingDecisions(
      store,
      [findingThread('t1', { previousDecision: 'adopted' })],
      [findingThread('t1', { previousDecision: 'adopted' })],
    );

    expect(store.set).not.toHaveBeenCalled();
    expect(store.delete).not.toHaveBeenCalled();
    expect(store.get('fp-1')?.decision).toBe('adopted');
  });

  it('does not rewrite an unchanged decision', async () => {
    const store = createMemoryStore({ 'fp-1': rejectedRecord });

    await syncFindingDecisions(
      store,
      [findingThread('t1', { decision: 'rejected' })],
      [findingThread('t1', { decision: 'rejected' })],
    );

    expect(store.set).not.toHaveBeenCalled();
  });

  it('ignores threads without a fingerprint', async () => {
    const store = createMemoryStore();

    await syncFindingDecisions(
      store,
      [],
      [findingThread('t1', { fingerprint: undefined, decision: 'adopted' })],
    );

    expect(store.all()).toEqual({});
  });
});
