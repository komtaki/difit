#!/usr/bin/env node
import { spawn, execFileSync } from 'child_process';
import { accessSync, constants, promises as fs } from 'fs';
import { createServer } from 'net';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

import { chromium } from 'playwright';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliPath = path.join(repoRoot, 'dist', 'cli', 'index.js');
const imagesDir = path.join(repoRoot, 'docs', 'images');

const DEMO_COMMIT = '776f33920b22a52fdc3d02f26767e3cc4a2585d9';
const DEMO_BASE = '82a765c037ec28fe7fe90ab2f1e4b5748032b4fa';
const DEMO_FILE = 'src/server/decision-store.ts';
const SYMBOL_LINE = 7;
const SYMBOL_NAME = 'DiffCommentThread';
const VIEWPORT = { width: 1440, height: 900 };

const OVERVIEW = `# Persist finding decisions across review rounds

AI reviewers re-run on every push, so the same finding keeps coming back after it was already rejected.
This change remembers each Adopt / Reject decision and applies it when the finding shows up again.

## What changed

| Area | Change |
| --- | --- |
| \`src/server/decision-store.ts\` | New per-branch JSON store under \`git rev-parse --git-common-dir\` |
| \`src/server/server.ts\` | Applies saved decisions to imported findings and saves new ones |
| \`src/cli/decision-commands.ts\` | \`decisions get\` / \`decisions clear\` subcommands |
| \`src/utils/commentImports.ts\` | Computes a fingerprint for each finding |

## How a decision is matched

1. A finding is fingerprinted by its explicit \`id\`, or by reviewer, file, title, and the trimmed line content.
2. When findings are imported, a saved decision with the same fingerprint is restored.
3. Changing or clearing a decision in the UI updates the store right away.

## Review focus

- Writes are serialized, so concurrent Adopt / Reject clicks cannot drop each other.
- A detached HEAD has no branch name, so decisions are not persisted there.
`;

const REVIEW_COMMENTS = [
  {
    type: 'thread',
    kind: 'explanation',
    filePath: DEMO_FILE,
    position: { side: 'new', line: { start: 105, end: 108 } },
    body: 'Decisions live under `--git-common-dir`, so every worktree of a clone shares them. One JSON file is kept per branch.',
  },
  {
    type: 'thread',
    kind: 'finding',
    reviewer: 'correctness',
    severity: 'warn',
    title: 'Detached HEAD silently disables decisions',
    filePath: DEMO_FILE,
    position: { side: 'new', line: { start: 108, end: 114 } },
    body: '`symbolic-ref` fails on a detached HEAD, the error is swallowed, and the store becomes `null`. Log a hint so users know why decisions are not carried over.',
  },
  {
    type: 'thread',
    kind: 'explanation',
    filePath: DEMO_FILE,
    position: { side: 'new', line: { start: 140, end: 155 } },
    body: 'Each write is chained on `pendingWrite` and goes through a temporary file plus `rename`, so a crash never leaves half-written JSON behind.',
  },
  {
    type: 'thread',
    kind: 'finding',
    reviewer: 'reliability',
    severity: 'info',
    title: 'Temporary file is left behind if rename fails',
    filePath: DEMO_FILE,
    position: { side: 'new', line: { start: 149, end: 151 } },
    body: 'Remove `temporaryPath` in a `catch` so a failed rename does not accumulate `.tmp` files in the decisions directory.',
  },
];

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

function isExecutable(filePath) {
  try {
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function findTypeScriptLanguageServer() {
  const directories = [
    path.join(repoRoot, 'node_modules', '.bin'),
    ...(process.env.PATH ?? '').split(path.delimiter).filter(Boolean),
  ];
  return (
    directories
      .map((directory) => path.join(directory, 'typescript-language-server'))
      .find(isExecutable) ?? null
  );
}

async function prepareDemoRepository(workDir) {
  const demoRepo = path.join(workDir, 'repo');
  execFileSync('git', ['clone', '--quiet', '--no-checkout', repoRoot, demoRepo]);
  execFileSync('git', ['-C', demoRepo, 'checkout', '--quiet', '--detach', DEMO_COMMIT]);
  await fs.symlink(path.join(repoRoot, 'node_modules'), path.join(demoRepo, 'node_modules'));
  return demoRepo;
}

async function startServer({ demoRepo, workDir }) {
  const overviewPath = path.join(workDir, 'overview.md');
  await fs.writeFile(overviewPath, OVERVIEW);

  const configDir = path.join(workDir, 'config');
  await fs.mkdir(configDir);
  await fs.writeFile(
    path.join(configDir, 'config.json'),
    JSON.stringify({
      version: 1,
      client: { appearance: { theme: 'light', syntaxTheme: 'github' } },
    }),
  );

  const port = await findFreePort();
  const child = spawn(
    process.execPath,
    [
      cliPath,
      'HEAD',
      DEMO_BASE,
      '--no-open',
      '--keep-alive',
      '--clean',
      '--port',
      String(port),
      '--overview',
      overviewPath,
      '--comment',
      JSON.stringify(REVIEW_COMMENTS),
    ],
    {
      cwd: demoRepo,
      env: {
        ...process.env,
        DIFIT_CONFIG_DIR: configDir,
        MISE_TRUSTED_CONFIG_PATHS: demoRepo,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  const exited = new Promise((resolve) => child.once('exit', resolve));
  const url = await new Promise((resolve, reject) => {
    let output = '';
    const onData = (chunk) => {
      output += chunk.toString();
      const match = output.match(/server started on (http:\/\/\S+)/);
      if (match) {
        child.stdout.off('data', onData);
        resolve(match[1]);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', (chunk) => process.stderr.write(chunk));
    child.once('exit', (code) => reject(new Error(`lensdiff exited early (${code}):\n${output}`)));
  });

  const stop = async () => {
    if (child.exitCode !== null) return;
    child.kill('SIGINT');
    const timeout = new Promise((resolve) => setTimeout(resolve, 10_000, 'timeout'));
    if ((await Promise.race([exited, timeout])) === 'timeout') {
      child.kill('SIGKILL');
      await exited;
    }
  };

  return { url, stop };
}

async function openTab(page, name) {
  await page.getByRole('tab', { name }).click();
  await page.waitForTimeout(300);
}

async function captureFilesChanged(page) {
  await openTab(page, 'Files changed');
  const file = page.locator(`[data-file-path="${DEMO_FILE}"]`);
  await file.evaluate((element) => element.scrollIntoView({ block: 'start' }));
  await file.locator('[data-thread-kind="finding"]').first().waitFor();
  await file
    .locator('[data-symbol-line="98"]')
    .first()
    .evaluate((line) => {
      line.scrollIntoView({ block: 'start' });
    });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(imagesDir, 'screenshot.png') });
}

async function captureOverview(page) {
  await openTab(page, 'Overview');
  await page
    .getByRole('heading', { name: 'Persist finding decisions across review rounds' })
    .waitFor();
  await page.screenshot({ path: path.join(imagesDir, 'overview.png') });
}

async function captureSymbolPanel(page) {
  await openTab(page, 'Files changed');
  const line = page
    .locator(`[data-file-path="${DEMO_FILE}"] [data-symbol-line="${SYMBOL_LINE}"]`)
    .first();
  await line.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  const position = await line.evaluate((element, symbol) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const index = node.textContent.indexOf(symbol);
      if (index === -1) continue;
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + symbol.length);
      const symbolRect = range.getBoundingClientRect();
      const lineRect = element.getBoundingClientRect();
      return {
        x: symbolRect.x + symbolRect.width / 2 - lineRect.x,
        y: symbolRect.y + symbolRect.height / 2 - lineRect.y,
      };
    }
    return null;
  }, SYMBOL_NAME);
  if (!position) {
    throw new Error(`${SYMBOL_NAME} was not found on line ${SYMBOL_LINE} of ${DEMO_FILE}`);
  }

  await line.click({ position, modifiers: ['ControlOrMeta'] });
  const fileView = page.getByRole('region', { name: 'File content' });
  const targetLine = fileView.locator('[data-target-line="true"]');
  await targetLine.waitFor({ timeout: 60_000 });
  await targetLine.hover();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(imagesDir, 'symbol-panel.png') });
}

async function main() {
  await fs.access(cliPath).catch(() => {
    throw new Error(`${cliPath} is missing. Run \`pnpm build\` first.`);
  });

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lensdiff-screenshots-'));
  let server;
  let browser;
  try {
    const demoRepo = await prepareDemoRepository(workDir);
    server = await startServer({ demoRepo, workDir });
    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: VIEWPORT, colorScheme: 'light' });
    await context.addInitScript(() => {
      localStorage.setItem('difit.diffViewMode', 'unified');
    });
    const page = await context.newPage();
    await page.goto(server.url);
    await page.getByRole('tablist').waitFor();

    await captureOverview(page);
    await captureFilesChanged(page);
    console.log('Captured docs/images/overview.png and docs/images/screenshot.png');

    if (findTypeScriptLanguageServer()) {
      await captureSymbolPanel(page);
      console.log('Captured docs/images/symbol-panel.png');
    } else {
      console.warn(
        'Skipped docs/images/symbol-panel.png: typescript-language-server is not in node_modules/.bin or on PATH.',
      );
    }
  } finally {
    await browser?.close();
    await server?.stop();
    await fs.rm(workDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
