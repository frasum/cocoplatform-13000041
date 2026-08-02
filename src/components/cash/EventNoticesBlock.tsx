// EV1-R2/R3 — Kompakter, permanenter Event-Hinweis in der Tagesabrechnung
// (F7/F8). Reine Anzeige: kein Schließen, keine Quittierung, keine
// Rechenwirkung. R3: blau getönt und auf ca. halbe Höhe verdichtet.

import { Card } from "@/components/ui/card";
import { AlertTriangle, CalendarClock } from "lucide-react";
import { ImpactBadge } from "@/components/events/ImpactBadge";
import type { EventNotice } from "@/lib/events/event-notices";
import type { SchoolHolidayNotice } from "@/lib/events/school-holiday-notices";
import { noticesTone, type NoticesTone } from "@/lib/events/notices-tone";

// UI2 — Tonlagen der Karte (Ramp-Klassen, dark-mode-fähig, keine rohen Hex).
const TONE_CARD: Record<NoticesTone, string> = {
  info: "border-blue-300 border-l-blue-500 bg-blue-100/70 dark:border-blue-800 dark:border-l-blue-500 dark:bg-blue-950/50",
  warning:
    "border-amber-300 border-l-amber-500 bg-amber-100/70 dark:border-amber-800 dark:border-l-amber-500 dark:bg-amber-950/50",
  danger:
    "border-red-300 border-l-red-500 bg-red-100/70 dark:border-red-900 dark:border-l-red-500 dark:bg-red-950/50",
};

const TONE_TITLE: Record<NoticesTone, string> = {
  info: "text-blue-900 dark:text-blue-100",
  warning: "text-amber-900 dark:text-amber-100",
  danger: "text-red-900 dark:text-red-100",
};

function noticeText(n: EventNotice): string {
  if (n.kind === "tomorrow") return `Morgen: ${n.name}`;
  return `${n.name} läuft — Tag ${n.dayIndex}/${n.dayCount}`;
}

// FK1: Ferien sind Dauerkontext, keine Impact-Stufe — eigener, dezenter Ton.
function holidayText(n: SchoolHolidayNotice): string {
  if (n.kind === "holiday_tomorrow") return `Morgen beginnen die ${n.name}`;
  return `${n.name} — Tag ${n.dayIndex}/${n.dayCount}`;
}

export function EventNoticesBlock({
  notices,
  schoolHolidays = [],
}: {
  notices: readonly EventNotice[];
  schoolHolidays?: readonly SchoolHolidayNotice[];
}) {
  if (notices.length === 0 && schoolHolidays.length === 0) return null;
  const tone = noticesTone(notices);
  const TitleIcon = tone === "danger" ? AlertTriangle : CalendarClock;
  return (
    <Card
      className={`h-full space-y-1 overflow-hidden rounded-l-none border-l-4 p-2.5 ${TONE_CARD[tone]}`}
    >
      <div
        className={`flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide ${TONE_TITLE[tone]}`}
      >
        <TitleIcon className="h-3 w-3" />
        Messen & VERANSTALTUNGEN & FERIEN
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
      {schoolHolidays.map((n, i) => (
        <div
          key={`ferien-${n.name}-${i}`}
          className="flex flex-wrap items-center gap-1.5 text-xs leading-tight"
        >
          <span className="text-foreground">{holidayText(n)}</span>
          <span className="inline-flex rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Ferien
          </span>
        </div>
      ))}
    </Card>
  );
}
