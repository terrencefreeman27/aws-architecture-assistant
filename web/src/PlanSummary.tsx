import type { Plan } from '../../shared/schema';
import type { PlanTab } from './PlanDetails';

/** Where a summary item leads: a tab under the diagram, or a section of the Assistant panel. */
export type SummaryTarget = { tab: PlanTab } | { section: 'assumptions' | 'open-questions' | 'cautions' };

interface Item {
  key: string;
  count: number;
  one: string;
  many: string;
  target: SummaryTarget;
  hint: string;
}

export function summaryItems(plan: Plan): Item[] {
  const items: Item[] = [
    { key: 'components', count: plan.nodes.length, one: 'component', many: 'components', target: { tab: 'Components' }, hint: 'Show the components tab' },
    { key: 'assumptions', count: plan.assumptions.length, one: 'assumption', many: 'assumptions', target: { section: 'assumptions' }, hint: 'Go to the assumptions in the Assistant panel' },
    { key: 'alternatives', count: plan.alternatives.length, one: 'alternative', many: 'alternatives', target: { tab: 'Alternatives' }, hint: 'Show the alternatives tab' },
    { key: 'open-questions', count: plan.openQuestions.length, one: 'open question', many: 'open questions', target: { section: 'open-questions' }, hint: 'Go to the open questions in the Assistant panel' },
    { key: 'cautions', count: plan.cautions.length, one: 'caution', many: 'cautions', target: { section: 'cautions' }, hint: 'Go to the cautions in the Assistant panel' },
  ];
  // Sections that do not exist in the panel (nothing to show) are left out rather than linking nowhere.
  return items.filter((i) => i.count > 0);
}

export function PlanSummary({ plan, onJump }: { plan: Plan; onJump: (target: SummaryTarget) => void }) {
  return (
    <nav className="plan-summary" aria-label="Plan summary" data-testid="plan-summary">
      <ul>
        {summaryItems(plan).map((item) => (
          <li key={item.key}>
            <button type="button" className="summary-item" onClick={() => onJump(item.target)} title={item.hint} data-testid={`summary-${item.key}`}>
              <span className="summary-count">{item.count}</span> {item.count === 1 ? item.one : item.many}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
