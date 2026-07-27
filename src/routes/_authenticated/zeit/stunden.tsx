import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getMyPeriodEntries } from "@/lib/time/time.functions";
import {
  entryNetMinutes,
  formatMinutes,
  groupEntriesByDay,
  periodTotalMinutes,
  type EntryInput,
} from "@/lib/time/my-period-hours";
import { derivePeriodLabel } from "@/lib/time/period-label";

export const Route = createFileRoute("/_authenticated/zeit/stunden")({
  head: () => ({
    meta: [
      { title: "Meine Stunden" },
      {
        name: "description",
        content: "Gearbeitete Schichten & Stundensumme der Abrechnungsperiode",
      },
    ],
  }),
  component: MyHoursPage,
});

function formatDdMm(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}.${m}.`;
}

function formatDayHeader(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString("de-DE", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  });
}

function formatHm(iso: string): string {
  const d = new Date(iso);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

function monthLabelFromEnd(endDate: string): string {
  const d = new Date(`${endDate}T00:00:00`);
  return d.toLocaleDateString("de-DE", { month: "long", year: "numeric" });
}

function MyHoursPage() {
  const [offset, setOffset] = useState(0);
  const fetchEntries = useServerFn(getMyPeriodEntries);
  const query = useQuery({
    queryKey: ["my-period-entries", offset],
    queryFn: () => fetchEntries({ data: { periodOffset: offset } }),
  });

  return (
    <main className="mx-auto max-w-xl space-y-6 px-4 py-8">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Meine Stunden</h1>
        <Link to="/zeit" className="text-sm text-muted-foreground hover:text-foreground">
          Zurück
        </Link>
      </header>

      <div className="flex items-center justify-between gap-2">
        <Button
          size="icon"
          variant="outline"
          onClick={() => setOffset((o) => Math.max(-24, o - 1))}
          disabled={offset <= -24}
          aria-label="Vorherige Periode"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 text-center">
          {query.data ? (
            <>
              <div className="text-sm font-medium">
                {monthLabelFromEnd(query.data.period.endDate)} ·{" "}
                {formatDdMm(query.data.period.startDate)}–{formatDdMm(query.data.period.endDate)}
              </div>
              {query.data.period.isCurrent && (
                <Badge variant="secondary" className="mt-1">
                  aktuelle Periode
                </Badge>
              )}
            </>
          ) : (
            <div className="text-sm text-muted-foreground">…</div>
          )}
        </div>
        <Button
          size="icon"
          variant="outline"
          onClick={() => setOffset((o) => Math.min(0, o + 1))}
          disabled={offset >= 0}
          aria-label="Nächste Periode"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {query.isLoading ? (
        <Card className="p-6 text-sm text-muted-foreground">Lade…</Card>
      ) : query.isError ? (
        <Card className="p-6 text-sm text-destructive">
          {(query.error as Error)?.message ?? "Stunden konnten nicht geladen werden."}
        </Card>
      ) : query.data ? (
        <MyHoursBody entries={query.data.entries} pausenBezahlt={query.data.pausenBezahlt} />
      ) : null}
    </main>
  );
}

type Entry = EntryInput & {
  id: string;
  source: "clock" | "manual";
  locationName: string | null;
  locationDayServiceEnabled: boolean;
};

function MyHoursBody({ entries, pausenBezahlt }: { entries: Entry[]; pausenBezahlt: boolean }) {
  const total = periodTotalMinutes(entries, pausenBezahlt);
  const days = groupEntriesByDay(entries, pausenBezahlt);

  if (entries.length === 0) {
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        Noch keine gearbeiteten Schichten in dieser Periode.
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">Gesamt</div>
        <div className="text-2xl font-semibold">{formatMinutes(total)}</div>
        <div className="text-xs text-muted-foreground">{days.length} Arbeitstage</div>
      </Card>

      <div className="space-y-3">
        {days.map((day) => (
          <section key={day.businessDate} className="space-y-1">
            <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              {formatDayHeader(day.businessDate)}
            </h2>
            <Card className="divide-y">
              {day.entries.map((e) => {
                const net = entryNetMinutes(e, pausenBezahlt);
                return (
                  <div key={e.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0 space-y-0.5 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">
                          {net === null
                            ? `seit ${formatHm(e.startedAt)} — läuft`
                            : `${formatHm(e.startedAt)}–${formatHm(e.endedAt!)}`}
                        </span>
                        {e.source === "manual" && (
                          <Badge variant="outline" className="text-[10px]">
                            korrigiert
                          </Badge>
                        )}
                        {e.locationDayServiceEnabled && (
                          <Badge variant="secondary" className="text-[10px]">
                            {derivePeriodLabel(e.startedAt)}
                          </Badge>
                        )}
                      </div>
                      {net !== null && e.breakMinutes > 0 && (
                        <div className="text-xs text-muted-foreground">
                          {e.breakMinutes} min Pause
                        </div>
                      )}
                      {e.locationName && (
                        <div className="text-xs text-muted-foreground">{e.locationName}</div>
                      )}
                    </div>
                    <div className="whitespace-nowrap text-right text-sm font-semibold">
                      {net === null ? "—" : formatMinutes(net)}
                    </div>
                  </div>
                );
              })}
              {day.entries.some((e) => entryNetMinutes(e, pausenBezahlt) !== null) &&
                day.entries.length > 1 && (
                  <div className="flex items-center justify-between px-4 py-2 text-xs text-muted-foreground">
                    <span>Tag gesamt</span>
                    <span className="font-medium text-foreground">
                      {formatMinutes(day.netMinutes)}
                    </span>
                  </div>
                )}
            </Card>
          </section>
        ))}
      </div>
    </div>
  );
}
