export type ReviewTab = 'overview' | 'files' | 'findings';

interface ReviewTabsProps {
  activeTab: ReviewTab;
  findingCount: number;
  onChange: (tab: ReviewTab) => void;
}

export function ReviewTabs({ activeTab, findingCount, onChange }: ReviewTabsProps) {
  const tabs: Array<{ id: ReviewTab; label: string }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'files', label: 'Files changed' },
    { id: 'findings', label: `AI review (${findingCount})` },
  ];

  return (
    <div
      role="tablist"
      className="flex gap-1 border-b border-github-border bg-github-bg-secondary px-4"
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.id)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm transition-colors ${
              isActive
                ? 'border-github-warning font-semibold text-github-text-primary'
                : 'border-transparent text-github-text-secondary hover:text-github-text-primary'
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
