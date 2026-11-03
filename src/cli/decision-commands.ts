import { Command } from 'commander';

import {
  createDecisionStore,
  type DecisionStore,
  InvalidBranchNameError,
} from '../server/decision-store.js';

async function openDecisionStore(
  repoPath: string,
  branch: string | undefined,
): Promise<DecisionStore | null> {
  let store: DecisionStore | null;
  try {
    store = await createDecisionStore({ repoPath, ...(branch ? { branch } : {}) });
  } catch (error) {
    if (!(error instanceof InvalidBranchNameError)) {
      throw error;
    }
    console.error(`Error: ${error.message}`);
    process.exit(1);
    return null;
  }
  if (!store) {
    console.error(
      'Error: Cannot determine the branch to store decisions for. Run inside a git repository on a branch or pass --branch.',
    );
    process.exit(1);
  }
  return store;
}

export function createDecisionsCommand(repoPath = process.cwd()): Command {
  const decisions = new Command('decisions').description(
    'Inspect or clear adopted/rejected AI findings saved for a branch',
  );

  decisions
    .command('get')
    .description('Print saved decisions as JSON')
    .option('--branch <name>', 'branch to read (defaults to the current branch)')
    .action(async (opts: { branch?: string }) => {
      const store = await openDecisionStore(repoPath, opts.branch);
      if (store) {
        console.log(JSON.stringify(store.all()));
      }
    });

  decisions
    .command('clear')
    .description('Delete saved decisions')
    .option('--branch <name>', 'branch to clear (defaults to the current branch)')
    .action(async (opts: { branch?: string }) => {
      const store = await openDecisionStore(repoPath, opts.branch);
      if (store) {
        await store.clear();
        console.log(JSON.stringify({ success: true }));
      }
    });

  return decisions;
}
