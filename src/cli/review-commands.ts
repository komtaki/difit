import { readFile } from 'fs/promises';

import { Command } from 'commander';

import type { ReviewerStatus } from '../types/review.js';

import { handleCommandError } from './comment.js';
import { detectStdinSource, readStdin } from './utils.js';

const reviewerSubcommands: ReadonlyArray<{
  name: string;
  status: ReviewerStatus;
  description: string;
}> = [
  { name: 'start', status: 'running', description: 'Mark a reviewer as running' },
  { name: 'done', status: 'done', description: 'Mark a reviewer as done' },
];

export async function readOverviewFile(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    throw new Error(`Cannot read overview file: ${filePath}`);
  }
}

async function readOverviewInput(filePath?: string): Promise<string> {
  if (filePath !== undefined) {
    return readOverviewFile(filePath);
  }

  if (detectStdinSource() === 'tty') {
    throw new Error('Provide overview markdown as a file argument or via stdin');
  }

  return readStdin();
}

async function sendToServer(
  port: number,
  path: string,
  method: 'PUT' | 'POST',
  body: unknown,
): Promise<void> {
  const response = await fetch(`http://localhost:${port}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(errorBody.error ?? `Request to ${path} failed`);
  }
}

export function createOverviewCommand(): Command {
  const overview = new Command('overview').description(
    'Manage the change overview on a running difit server',
  );

  overview
    .command('set')
    .description('Set the change overview markdown')
    .argument('[file]', 'markdown file (reads stdin when omitted)')
    .requiredOption('--port <port>', 'port of the running difit server', parseInt)
    .action(async (file: string | undefined, opts: { port: number }) => {
      try {
        const markdown = await readOverviewInput(file);
        await sendToServer(opts.port, '/api/overview', 'PUT', { markdown });
        console.log(JSON.stringify({ success: true }));
      } catch (error) {
        handleCommandError(error, opts.port);
      }
    });

  return overview;
}

export function createReviewerCommand(): Command {
  const reviewer = new Command('reviewer').description(
    'Report AI reviewer progress to a running difit server',
  );

  for (const { name, status, description } of reviewerSubcommands) {
    reviewer
      .command(name)
      .description(description)
      .argument('<name>', 'reviewer name')
      .requiredOption('--port <port>', 'port of the running difit server', parseInt)
      .action(async (reviewerName: string, opts: { port: number }) => {
        try {
          await sendToServer(opts.port, '/api/reviewers', 'POST', { name: reviewerName, status });
          console.log(JSON.stringify({ success: true, reviewer: { name: reviewerName, status } }));
        } catch (error) {
          handleCommandError(error, opts.port);
        }
      });
  }

  return reviewer;
}
