import { createHash, randomUUID } from 'crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'fs/promises';
import { dirname, join, resolve, sep } from 'path';

import { simpleGit } from 'simple-git';

import type { DiffCommentThread, FindingDecision } from '../types/diff.js';

export interface DecisionRecord {
  decision: FindingDecision;
  reviewer: string;
  filePath: string;
  title: string;
  decidedAt: string;
}

export interface DecisionStore {
  filePath: string;
  get(fingerprint: string): DecisionRecord | undefined;
  set(fingerprint: string, record: DecisionRecord): Promise<void>;
  delete(fingerprint: string): Promise<void>;
  all(): Record<string, DecisionRecord>;
  clear(): Promise<void>;
}

interface FingerprintInput {
  id?: string;
  reviewer: string;
  filePath: string;
  title: string;
  lineContent: string;
}

export function computeFindingFingerprint({
  id,
  reviewer,
  filePath,
  title,
  lineContent,
}: FingerprintInput): string {
  if (id) {
    return `id:${id}`;
  }

  return createHash('sha256')
    .update([reviewer, filePath, title, lineContent.trim()].join('\0'))
    .digest('hex');
}

function isDecisionRecord(value: unknown): value is DecisionRecord {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const { decision, reviewer, filePath, title, decidedAt } = value as Record<string, unknown>;
  return (
    (decision === 'adopted' || decision === 'rejected') &&
    typeof reviewer === 'string' &&
    typeof filePath === 'string' &&
    typeof title === 'string' &&
    typeof decidedAt === 'string'
  );
}

async function readDecisionFile(filePath: string): Promise<Map<string, DecisionRecord>> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`Warning: Cannot read decisions file, starting empty: ${filePath}`);
    }
    return new Map();
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('Decisions file must be a JSON object');
    }
    return new Map(
      Object.entries(parsed).filter((entry): entry is [string, DecisionRecord] =>
        isDecisionRecord(entry[1]),
      ),
    );
  } catch {
    console.warn(`Warning: Ignoring invalid decisions file: ${filePath}`);
    return new Map();
  }
}

export class InvalidBranchNameError extends Error {
  constructor(branch: string) {
    super(`Invalid branch name: ${branch}`);
    this.name = 'InvalidBranchNameError';
  }
}

async function resolveDecisionFilePath(
  repoPath: string,
  branch: string | undefined,
): Promise<string | null> {
  const git = simpleGit(repoPath);
  let decisionsDir: string;
  let branchName: string;
  try {
    const commonDir = (await git.revparse(['--git-common-dir'])).trim();
    decisionsDir = join(resolve(repoPath, commonDir), 'lensdiff', 'decisions');
    branchName = branch ?? (await git.raw(['symbolic-ref', '--quiet', '--short', 'HEAD'])).trim();
  } catch {
    return null;
  }
  if (branchName.length === 0) {
    return null;
  }

  try {
    await git.raw(['check-ref-format', '--branch', branchName]);
  } catch {
    throw new InvalidBranchNameError(branchName);
  }
  const filePath = resolve(decisionsDir, `${branchName}.json`);
  if (!filePath.startsWith(`${decisionsDir}${sep}`)) {
    throw new InvalidBranchNameError(branchName);
  }
  return filePath;
}

export async function createDecisionStore(options: {
  repoPath: string;
  branch?: string;
}): Promise<DecisionStore | null> {
  const filePath = await resolveDecisionFilePath(options.repoPath, options.branch);
  if (!filePath) {
    return null;
  }

  const records = await readDecisionFile(filePath);
  let pendingWrite: Promise<void> = Promise.resolve();

  const persist = (applyChange: (current: Map<string, DecisionRecord>) => void): Promise<void> => {
    const write = async () => {
      const current = await readDecisionFile(filePath);
      applyChange(current);
      if (current.size === 0) {
        await rm(filePath, { force: true });
        return;
      }
      await mkdir(dirname(filePath), { recursive: true });
      const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
      await writeFile(temporaryPath, `${JSON.stringify(Object.fromEntries(current), null, 2)}\n`);
      await rename(temporaryPath, filePath);
    };
    pendingWrite = pendingWrite.then(write, write);
    return pendingWrite;
  };

  return {
    filePath,
    get: (fingerprint) => records.get(fingerprint),
    async set(fingerprint, record) {
      records.set(fingerprint, record);
      await persist((current) => current.set(fingerprint, record));
    },
    async delete(fingerprint) {
      records.delete(fingerprint);
      await persist((current) => current.delete(fingerprint));
    },
    all: () => Object.fromEntries(records),
    async clear() {
      records.clear();
      await persist((current) => current.clear());
    },
  };
}

export async function syncFindingDecisions(
  store: DecisionStore,
  previousThreads: DiffCommentThread[],
  nextThreads: DiffCommentThread[],
): Promise<void> {
  const previousDecisions = new Map(
    previousThreads.map((thread) => [thread.id, thread.finding?.decision]),
  );

  for (const thread of nextThreads) {
    const { finding } = thread;
    if (!finding?.fingerprint) {
      continue;
    }

    if (finding.decision) {
      if (store.get(finding.fingerprint)?.decision === finding.decision) {
        continue;
      }
      await store.set(finding.fingerprint, {
        decision: finding.decision,
        reviewer: finding.reviewer,
        filePath: thread.filePath,
        title: finding.title,
        decidedAt: new Date().toISOString(),
      });
    } else if (previousDecisions.get(thread.id)) {
      await store.delete(finding.fingerprint);
    }
  }
}
