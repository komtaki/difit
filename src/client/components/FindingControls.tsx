import { Check } from 'lucide-react';
import type React from 'react';

import type { FindingDecision, FindingMeta, FindingSeverity } from '../../types/diff';

const SEVERITY_CLASS: Record<FindingSeverity, string> = {
  info: 'border-github-text-secondary text-github-text-secondary',
  warn: 'border-github-warning text-github-warning',
  error: 'border-github-danger text-github-danger',
};

const BUTTON_CLASS =
  'whitespace-nowrap rounded border px-2 py-1 text-xs font-medium transition-colors';

export function SeverityBadge({ severity }: { severity: FindingSeverity }) {
  return (
    <span
      className={`inline-flex h-5 shrink-0 items-center rounded-full border px-2 text-[10px] font-semibold uppercase ${SEVERITY_CLASS[severity]}`}
    >
      {severity}
    </span>
  );
}

export function PreviousDecisionBadge({ decision }: { decision: FindingDecision }) {
  return (
    <span className="inline-flex h-5 shrink-0 items-center rounded-full border border-github-border px-2 text-[10px] font-medium text-github-text-secondary">
      {decision === 'adopted' ? 'Previously adopted — still unresolved?' : 'Previously rejected'}
    </span>
  );
}

export function FindingDecisionButtons({
  finding,
  onChange,
}: {
  finding: FindingMeta;
  onChange: (decision: FindingDecision | undefined) => void;
}) {
  const handle = (decision: FindingDecision | undefined) => (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(decision);
  };

  if (finding.decision === 'adopted') {
    return (
      <button
        type="button"
        onClick={handle(undefined)}
        title="Withdraw adoption"
        className={`${BUTTON_CLASS} border-[var(--color-finding-accent)] bg-[var(--color-finding-bg)] text-[var(--color-finding-text)]`}
      >
        <span className="inline-flex items-center gap-1">
          <Check size={12} aria-hidden="true" />
          Adopted
        </span>
      </button>
    );
  }

  if (finding.decision === 'rejected') {
    return (
      <button
        type="button"
        onClick={handle(undefined)}
        title="Show this finding in the diff again"
        className={`${BUTTON_CLASS} border-github-border bg-github-bg-secondary text-github-text-secondary hover:text-github-text-primary`}
      >
        Restore
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={handle('adopted')}
        className={`${BUTTON_CLASS} border-[var(--color-finding-accent)] text-[var(--color-finding-text)] hover:bg-[var(--color-finding-bg)]`}
      >
        Adopt
      </button>
      <button
        type="button"
        onClick={handle('rejected')}
        className={`${BUTTON_CLASS} border-github-border bg-github-bg-secondary text-github-text-secondary hover:text-github-text-primary`}
      >
        Reject
      </button>
    </>
  );
}
