import { Check, ChevronDown, ChevronRight, Copy, Edit2, MessageSquare, Trash2 } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';

import { type CommentThread, type DiffCommentMessage, type ThreadKind } from '../../types/diff';
import { useThreadReview } from '../contexts/ReviewThreadContext';
import { useClickOutside } from '../hooks/useClickOutside';
import { copyTextToClipboard } from '../utils/clipboard';

import { CommentBodyRenderer } from './CommentBodyRenderer';
import { CommentForm } from './CommentForm';
import { FindingDecisionButtons, PreviousDecisionBadge, SeverityBadge } from './FindingControls';
import type { AppearanceSettings } from './SettingsModal';

interface ThreadMessageItemProps {
  message: DiffCommentMessage;
  isRootMessage?: boolean;
  showAuthorBadge: boolean;
  syntaxTheme?: AppearanceSettings['syntaxTheme'];
  filename?: string;
  originalCode?: string;
  onUpdate: (newBody: string) => void;
  onResolveOrDelete: () => void;
  action: 'resolve' | 'delete';
  actionLabel: string;
  confirmPrompt?: string;
  onClick?: (e: React.MouseEvent) => void;
}

function ThreadMessageItem({
  message,
  isRootMessage = false,
  showAuthorBadge,
  syntaxTheme,
  filename,
  originalCode,
  onUpdate,
  onResolveOrDelete,
  action,
  actionLabel,
  confirmPrompt,
  onClick,
}: ThreadMessageItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const confirmContainerRef = useRef<HTMLDivElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const showAuthorHeader = showAuthorBadge && Boolean(message.author);
  const isUserAuthoredMessage = message.author?.trim() === 'User';
  const isResolveAction = action === 'resolve';

  useClickOutside(confirmContainerRef, () => setIsConfirming(false), isConfirming);

  useEffect(() => {
    if (!isConfirming) return;

    confirmButtonRef.current?.focus();

    // Capture phase so Escape only cancels the confirmation and never reaches
    // surrounding Escape handlers (e.g. the CommentsListModal close hotkey).
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setIsConfirming(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [isConfirming]);

  const handleStartEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
  };

  const handleSaveEdit = (nextBody: string) => {
    if (nextBody !== message.body) {
      onUpdate(nextBody);
    }
    setIsEditing(false);
    return Promise.resolve();
  };

  return (
    <div className={isEditing ? '' : 'flex min-w-0 items-start gap-3'} onClick={onClick}>
      {!isEditing ? (
        <>
          <div className="min-w-0 flex-1">
            {showAuthorHeader && (
              <div className="mb-2 flex min-w-0 items-center gap-2 pr-2 text-xs text-github-text-secondary">
                <span className="inline-flex items-center rounded-full border border-github-border bg-github-bg-primary px-2 py-0.5 text-[11px] font-medium text-github-text-primary">
                  {message.author}
                </span>
              </div>
            )}

            <CommentBodyRenderer
              body={message.body}
              originalCode={originalCode}
              filename={filename}
              syntaxTheme={syntaxTheme}
            />
          </div>
          {(isRootMessage || isUserAuthoredMessage) &&
            (isConfirming ? (
              <div
                ref={confirmContainerRef}
                className="flex shrink-0 items-center gap-1.5 pt-0.5"
                onClick={(e) => e.stopPropagation()}
              >
                <span className="whitespace-nowrap text-xs text-github-text-secondary">
                  {confirmPrompt}
                </span>
                <button
                  ref={confirmButtonRef}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsConfirming(false);
                    onResolveOrDelete();
                  }}
                  className={`whitespace-nowrap rounded border border-github-border bg-github-bg-tertiary px-2 py-1 text-xs font-medium transition-all hover:bg-github-bg-primary ${
                    isResolveAction ? 'text-green-700 hover:text-green-800' : 'text-github-danger'
                  }`}
                >
                  {isResolveAction ? 'Resolve' : 'Delete'}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsConfirming(false);
                  }}
                  className="whitespace-nowrap rounded border border-github-border bg-github-bg-tertiary px-2 py-1 text-xs text-github-text-primary transition-all hover:bg-github-bg-primary"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex shrink-0 items-start gap-2 pt-0.5">
                {isUserAuthoredMessage && (
                  <button
                    type="button"
                    onClick={handleStartEdit}
                    className="rounded border border-github-border bg-github-bg-tertiary p-1.5 text-github-text-primary transition-all hover:bg-github-bg-primary"
                    title="Edit message"
                  >
                    <Edit2 size={12} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirmPrompt) {
                      setIsConfirming(true);
                      return;
                    }
                    onResolveOrDelete();
                  }}
                  className={`rounded border border-github-border bg-github-bg-tertiary p-1.5 transition-all hover:bg-github-bg-primary ${
                    isResolveAction ? 'text-green-700 hover:text-green-800' : 'text-github-danger'
                  }`}
                  title={actionLabel}
                  aria-label={actionLabel}
                >
                  {isResolveAction ? <Check size={12} /> : <Trash2 size={12} />}
                </button>
              </div>
            ))}
        </>
      ) : (
        <CommentForm
          onSubmit={handleSaveEdit}
          onCancel={handleCancelEdit}
          selectedCode={originalCode}
          syntaxTheme={syntaxTheme}
          filename={filename}
          initialValue={message.body}
          embedded={true}
          title="Edit comment"
          submitLabel="Save"
          placeholder="Edit your message..."
        />
      )}
    </div>
  );
}

const CARD_BORDER_CLASS: Record<ThreadKind, string> = {
  comment: 'border-yellow-600/50 border-l-yellow-400',
  explanation:
    'border-[var(--color-explanation-border)] border-l-[var(--color-explanation-accent)]',
  finding: 'border-[var(--color-finding-border)] border-l-[var(--color-finding-accent)]',
};

const PATH_LABEL_STYLE: Record<ThreadKind, React.CSSProperties> = {
  comment: {
    backgroundColor: 'var(--color-yellow-path-bg)',
    color: 'var(--color-yellow-path-text)',
  },
  explanation: {
    backgroundColor: 'var(--color-explanation-bg)',
    color: 'var(--color-explanation-text)',
  },
  finding: {
    backgroundColor: 'var(--color-finding-bg)',
    color: 'var(--color-finding-text)',
  },
};

interface HeaderLayoutProps {
  isReviewThread: boolean;
  title?: string;
  isCollapsed: boolean;
  children: React.ReactNode;
}

function HeaderLayout({ isReviewThread, title, isCollapsed, children }: HeaderLayoutProps) {
  if (!isReviewThread) {
    return (
      <div className={`flex items-center justify-between gap-3 ${isCollapsed ? '' : 'mb-3'}`}>
        {children}
      </div>
    );
  }

  return (
    <div className={isCollapsed ? '' : 'mb-3'}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">{children}</div>
      {title && (
        <div className="mt-2 w-full break-words text-sm font-semibold text-github-text-primary">
          {title}
        </div>
      )}
    </div>
  );
}

interface CommentThreadCardProps {
  thread: CommentThread;
  showAuthorBadges?: boolean;
  confirmRootAction?: boolean;
  onGeneratePrompt: (thread: CommentThread) => string;
  onRemoveThread: (threadId: string) => void;
  onReplyToThread: (threadId: string, body: string) => Promise<void>;
  onRemoveMessage: (threadId: string, messageId: string) => void;
  onUpdateMessage: (threadId: string, messageId: string, newBody: string) => void;
  onClick?: (e: React.MouseEvent) => void;
  syntaxTheme?: AppearanceSettings['syntaxTheme'];
}

export function CommentThreadCard({
  thread,
  showAuthorBadges = false,
  confirmRootAction = true,
  onGeneratePrompt,
  onRemoveThread,
  onReplyToThread,
  onRemoveMessage,
  onUpdateMessage,
  onClick,
  syntaxTheme,
}: CommentThreadCardProps) {
  const review = useThreadReview(thread.id);
  const kind = review?.kind ?? 'comment';
  const finding = kind === 'finding' ? review?.finding : undefined;
  const isReviewThread = kind !== 'comment';
  const [isCopied, setIsCopied] = useState(false);
  const [isReplying, setIsReplying] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const lineLabel = Array.isArray(thread.line)
    ? `${thread.line[0]}-${thread.line[1]}`
    : thread.line;

  const toggleCollapsed = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsCollapsed((prev) => !prev);
  };

  const handleCopyThread = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const prompt = onGeneratePrompt(thread);
      await copyTextToClipboard(prompt);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy thread prompt:', error);
    }
  };

  const rootMessage = thread.messages[0];
  if (!rootMessage) return null;

  return (
    <div
      id={`comment-thread-${thread.id}`}
      data-thread-kind={kind}
      className={`rounded-md border border-l-4 ${CARD_BORDER_CLASS[kind]} bg-github-bg-tertiary p-3 shadow-sm transition-all ${
        onClick ? 'cursor-pointer hover:shadow-md' : ''
      }`}
      onClick={onClick}
    >
      <HeaderLayout
        isReviewThread={isReviewThread}
        title={finding?.title}
        isCollapsed={isCollapsed}
      >
        <div
          className={`flex items-center gap-2 text-xs text-github-text-secondary ${
            isReviewThread ? 'flex-auto flex-wrap' : 'min-w-0 flex-1'
          }`}
        >
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-expanded={!isCollapsed}
            aria-label={isCollapsed ? 'Expand thread' : 'Collapse thread'}
            title={isCollapsed ? 'Expand thread' : 'Collapse thread'}
            className="shrink-0 rounded p-0.5 text-github-text-secondary transition-colors hover:bg-github-bg-primary hover:text-github-text-primary"
          >
            {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          </button>
          {kind === 'explanation' && (
            <button
              type="button"
              onClick={toggleCollapsed}
              className="shrink-0 font-semibold text-[var(--color-explanation-text)]"
            >
              Explanation
            </button>
          )}
          {finding && (
            <>
              <SeverityBadge severity={finding.severity} />
              <span className="inline-flex h-5 shrink-0 items-center rounded-full bg-[var(--color-finding-bg)] px-2 text-[10px] font-medium text-[var(--color-finding-text)]">
                {finding.reviewer}
              </span>
              {finding.previousDecision && (
                <PreviousDecisionBadge decision={finding.previousDecision} />
              )}
            </>
          )}
          <span
            className="font-mono px-1 py-0.5 rounded overflow-hidden text-ellipsis whitespace-nowrap"
            style={PATH_LABEL_STYLE[kind]}
          >
            {thread.file}:{lineLabel}
          </span>
          {thread.isOutdated && (
            <span
              className="inline-flex h-5 shrink-0 items-center rounded-full border border-github-text-muted px-2 text-[10px] font-medium text-github-text-muted"
              title="Code has changed since this comment was made"
              aria-label="Outdated comment"
            >
              Outdated
            </span>
          )}
          {isCollapsed && (
            <button
              type="button"
              onClick={toggleCollapsed}
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
              title="Expand thread"
            >
              <span className="min-w-0 flex-1 truncate text-github-text-secondary">
                {rootMessage.body.split('\n')[0]}
              </span>
              <span
                className="inline-flex shrink-0 items-center gap-1 text-github-text-muted"
                aria-label={`${thread.messages.length} messages in thread`}
              >
                <MessageSquare size={12} />
                {thread.messages.length}
              </span>
            </button>
          )}
        </div>
        {!isCollapsed && (
          <div
            className={`flex items-center gap-2 ${
              isReviewThread ? 'ml-auto flex-wrap justify-end' : ''
            }`}
          >
            {finding && review && (
              <FindingDecisionButtons finding={finding} onChange={review.setDecision} />
            )}
            <button
              type="button"
              onClick={handleCopyThread}
              className="whitespace-nowrap rounded px-2 py-1 text-xs transition-all"
              style={{
                backgroundColor: 'var(--color-yellow-btn-bg)',
                color: 'var(--color-yellow-btn-text)',
                border: '1px solid var(--color-yellow-btn-border)',
              }}
              title="Copy thread prompt for AI coding agent"
            >
              <span className="inline-flex items-center gap-1">
                <Copy size={12} />
                {isCopied ? 'Copied!' : 'Copy Prompt'}
              </span>
            </button>
          </div>
        )}
      </HeaderLayout>

      {!isCollapsed && (
        <div className="space-y-3">
          <ThreadMessageItem
            message={rootMessage}
            isRootMessage={true}
            showAuthorBadge={showAuthorBadges}
            syntaxTheme={syntaxTheme}
            filename={thread.file}
            originalCode={thread.codeContent}
            onUpdate={(newBody) => onUpdateMessage(thread.id, rootMessage.id, newBody)}
            onResolveOrDelete={() => onRemoveThread(thread.id)}
            action={isReviewThread ? 'resolve' : 'delete'}
            actionLabel={isReviewThread ? 'Resolve thread' : 'Delete thread'}
            confirmPrompt={
              confirmRootAction ? (isReviewThread ? 'Resolve?' : 'Delete?') : undefined
            }
          />

          {thread.messages.slice(1).map((message) => (
            <div key={message.id} className="ml-4 border-l border-github-border pl-3">
              <ThreadMessageItem
                message={message}
                showAuthorBadge={showAuthorBadges}
                syntaxTheme={syntaxTheme}
                filename={thread.file}
                originalCode={thread.codeContent}
                onUpdate={(newBody) => onUpdateMessage(thread.id, message.id, newBody)}
                onResolveOrDelete={() => onRemoveMessage(thread.id, message.id)}
                action="delete"
                actionLabel="Delete reply"
                confirmPrompt="Delete?"
              />
            </div>
          ))}

          <div
            className="ml-4 border-l border-github-border pl-3"
            onClick={(e) => e.stopPropagation()}
          >
            {isReplying ? (
              <CommentForm
                onSubmit={async (body) => {
                  await onReplyToThread(thread.id, body);
                  setIsReplying(false);
                }}
                onCancel={() => setIsReplying(false)}
                selectedCode={thread.codeContent}
                syntaxTheme={syntaxTheme}
                filename={thread.file}
                embedded={true}
                title="Reply to thread"
                submitLabel="Reply"
                placeholder="Write a reply..."
              />
            ) : (
              <button
                type="button"
                data-reply-trigger="true"
                onFocus={() => setIsReplying(true)}
                onClick={() => setIsReplying(true)}
                className="w-full cursor-text rounded border border-github-border bg-github-bg-secondary px-3 py-1.5 text-left text-sm text-github-text-muted transition-colors hover:border-github-text-secondary"
              >
                Write a reply...
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
