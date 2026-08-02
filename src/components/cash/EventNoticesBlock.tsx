// EV1-R2/R3 — Kompakter, permanenter Event-Hinweis in der Tagesabrechnung
// (F7/F8). Reine Anzeige: kein Schließen, keine Quittierung, keine
// Rechenwirkung. R3: blau getönt und auf ca. halbe Höhe verdichtet.

import { Card } from "@/components/ui/card";
import { CalendarClock } from "lucide-react";
import { ImpactBadge } from "@/components/events/ImpactBadge";
import type { EventNotice } from "@/lib/events/event-notices";

function noticeText(n: EventNotice): string {
  if (n.kind === "tomorrow") return `Morgen: ${n.name}`;
  return `${n.name} läuft — Tag ${n.dayIndex}/${n.dayCount}`;
}

export function EventNoticesBlock({ notices }: { notices: readonly EventNotice[] }) {
  if (notices.length === 0) return null;
  return (
    <Card className="h-full space-y-1 border-blue-200 bg-blue-50/70 p-2.5 dark:border-blue-900 dark:bg-blue-950/30">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-blue-900/70 dark:text-blue-100/70">
        <CalendarClock className="h-3 w-3" />
        Veranstaltungen
      </div>
      {notices.map((n, i) => (
        <div
          key={`${n.kind}-${n.name}-${i}`}
          className="flex flex-wrap items-center gap-1.5 text-xs leading-tight"
        >
          <span className="text-foreground">{noticeText(n)}</span>
          <ImpactBadge impact={n.impact} />
          {n.provisional && (
            <span className="text-[10px] text-muted-foreground">(Termin vorläufig)</span>
          )}
        </div>
      ))}
    </Card>
  );
}
