// EV1-R2 — Kompakter, permanenter Event-Hinweis in der Tagesabrechnung (F7/F8).
// Reine Anzeige: kein Schließen, keine Quittierung, keine Rechenwirkung.

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
    <Card className="space-y-1.5 p-4">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <CalendarClock className="h-3.5 w-3.5" />
        Veranstaltungen
      </div>
      {notices.map((n, i) => (
        <div key={`${n.kind}-${n.name}-${i}`} className="flex items-center gap-2 text-sm">
          <span className="text-foreground">{noticeText(n)}</span>
          <ImpactBadge impact={n.impact} />
          {n.provisional && (
            <span className="text-xs text-muted-foreground">(Termin vorläufig)</span>
          )}
        </div>
      ))}
    </Card>
  );
}
