// EV1-R1 — Impact-Badge in gedeckten Tönen (Vorbild PriorityChip).

import { IMPACT_LABEL, type EventImpact } from "@/lib/events/events-core";

const TONE: Record<EventImpact, string> = {
  sehr_hoch: "bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-100",
  hoch: "bg-orange-100 text-orange-900 dark:bg-orange-900/40 dark:text-orange-100",
  mittel_hoch: "bg-yellow-100 text-yellow-900 dark:bg-yellow-900/40 dark:text-yellow-100",
  mittel: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
};

export function ImpactBadge({ impact }: { impact: EventImpact }) {
  return (
    <span
      className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${TONE[impact]}`}
    >
      {IMPACT_LABEL[impact]}
    </span>
  );
}