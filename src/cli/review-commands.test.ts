import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./utils.js', () => ({
  detectStdinSource: vi.fn(),
  readStdin: vi.fn(),
}));

const { detectStdinSource, readStdin } = await import('./utils.js');
const { createOverviewCommand, createReviewerCommand, readOverviewFile } =
  await import('./review-commands.js');

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('review commands', () => {
  const originalFetch = globalThis.fetch;
  let mockFetch: ReturnType<typeof vi.fn<typeof fetch>>;
  let originalProcessExit: typeof process.exit;
  let consoleOutput: string[];
  let consoleErrors: string[];
  let tempDir: string;

  beforeEach(async () => {
    mockFetch = vi.fn<typeof fetch>();
    globalThis.fetch = mockFetch;

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

    tempDir = await fs.mkdtemp(join(tmpdir(), 'difit-review-commands-'));
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    process.exit = originalProcessExit;
    vi.restoreAllMocks();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('readOverviewFile', () => {
    it('reads the overview markdown from a file', async () => {
      const filePath = join(tempDir, 'overview.md');
      await fs.writeFile(filePath, '# Overview\n');

      await expect(readOverviewFile(filePath)).resolves.toBe('# Overview\n');
    });

    it('throws a descriptive error when the file cannot be read', async () => {
      const filePath = join(tempDir, 'missing.md');

      await expect(readOverviewFile(filePath)).rejects.toThrow(
        `Cannot read overview file: ${filePath}`,
      );
    });
  });

  describe('overview set', () => {
    it('sends the file content to the server', async () => {
      const filePath = join(tempDir, 'overview.md');
      await fs.writeFile(filePath, '# From file');
      mockFetch.mockResolvedValue(jsonResponse({ success: true }));

      await createOverviewCommand().parseAsync([
        'node',
        'difit',
        'set',
        '--port',
        '4966',
        filePath,
      ]);

      expect(mockFetch).toHaveBeenCalledWith('http://localhost:4966/api/overview', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markdown: '# From file' }),
      });
      expect(consoleOutput[0]).toBe(JSON.stringify({ success: true }));
      expect(process.exit).not.toHaveBeenCalled();
    });

    it('reads the overview from stdin when no file is given', async () => {
      vi.mocked(detectStdinSource).mockReturnValue('pipe');
      vi.mocked(readStdin).mockResolvedValue('# From stdin');
      mockFetch.mockResolvedValue(jsonResponse({ success: true }));

      await createOverviewCommand().parseAsync(['node', 'difit', 'set', '--port', '4966']);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:4966/api/overview',
        expect.objectContaining({ body: JSON.stringify({ markdown: '# From stdin' }) }),
      );
    });

    it('fails without contacting the server when stdin is a terminal', async () => {
      vi.mocked(detectStdinSource).mockReturnValue('tty');

      await createOverviewCommand().parseAsync(['node', 'difit', 'set', '--port', '4966']);

      expect(mockFetch).not.toHaveBeenCalled();
      expect(consoleErrors[0]).toContain('Error:');
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    it('reports an unreadable file', async () => {
      const filePath = join(tempDir, 'missing.md');

      await createOverviewCommand().parseAsync([
        'node',
        'difit',
        'set',
        '--port',
        '4966',
        filePath,
      ]);

      expect(mockFetch).not.toHaveBeenCalled();
      expect(consoleErrors[0]).toBe(`Error: Cannot read overview file: ${filePath}`);
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    it('reports a server error response', async () => {
      const filePath = join(tempDir, 'overview.md');
      await fs.writeFile(filePath, '# From file');
      mockFetch.mockResolvedValue(jsonResponse({ error: 'Invalid overview payload' }, 400));

      await createOverviewCommand().parseAsync([
        'node',
        'difit',
        'set',
        '--port',
        '4966',
        filePath,
      ]);

      expect(consoleErrors[0]).toBe('Error: Invalid overview payload');
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    it('reports a connection error like the comment command', async () => {
      const filePath = join(tempDir, 'overview.md');
      await fs.writeFile(filePath, '# From file');
      mockFetch.mockRejectedValue(new TypeError('fetch failed'));

      await createOverviewCommand().parseAsync([
        'node',
        'difit',
        'set',
        '--port',
        '9999',
        filePath,
      ]);

      expect(consoleErrors[0]).toBe(
        'Error: Cannot connect to lensdiff server on port 9999. Is the server running?',
      );
      expect(process.exit).toHaveBeenCalledWith(1);
    });
  });

  describe('reviewer', () => {
    it.each([
      ['start', 'running'],
      ['done', 'done'],
    ])('%s posts the reviewer status', async (subcommand, status) => {
      mockFetch.mockResolvedValue(jsonResponse({ success: true }));

      await createReviewerCommand().parseAsync([
        'node',
        'difit',
        subcommand,
        '--port',
        '4966',
        'correctness',
      ]);

      expect(mockFetch).toHaveBeenCalledWith('http://localhost:4966/api/reviewers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'correctness', status }),
      });
      expect(consoleOutput[0]).toBe(
        JSON.stringify({ success: true, reviewer: { name: 'correctness', status } }),
      );
    });

    it('requires --port on every subcommand', () => {
      const command = createReviewerCommand();

      for (const subcommand of command.commands) {
        const portOption = subcommand.options.find((option) => option.long === '--port');
        expect(portOption?.mandatory).toBe(true);
      }
    });

    it('reports a server error response', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ error: 'Invalid reviewer payload' }, 400));

      await createReviewerCommand().parseAsync([
        'node',
        'difit',
        'start',
        '--port',
        '4966',
        'correctness',
      ]);

      expect(consoleErrors[0]).toBe('Error: Invalid reviewer payload');
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    it('reports a connection error like the comment command', async () => {
      mockFetch.mockRejectedValue(new TypeError('fetch failed'));

      await createReviewerCommand().parseAsync([
        'node',
        'difit',
        'done',
        '--port',
        '9999',
        'correctness',
      ]);

      expect(consoleErrors[0]).toBe(
        'Error: Cannot connect to lensdiff server on port 9999. Is the server running?',
      );
      expect(process.exit).toHaveBeenCalledWith(1);
    });
  });
});
