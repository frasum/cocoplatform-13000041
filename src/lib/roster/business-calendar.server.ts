// RT1 — Server-Helfer: assertDayOpen wird von Roster-Schreib-Fns
// aufgerufen, BEVOR eine Schicht angelegt/verschoben/bestätigt wird.
// Wirft eine verständliche Fehlermeldung, wenn der Standort an dem
// Tag geschlossen ist. Kein Audit-Eintrag bei Ablehnung (Hausregel).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { isClosedDay, isoWeekday, type CalendarExceptionKind } from "./business-calendar";
import { ValidationRejection } from "@/lib/monitoring/validation-rejection";

const WEEKDAY_LABEL: Record<number, string> = {
  1: "Montag",
  2: "Dienstag",
  3: "Mittwoch",
  4: "Donnerstag",
  5: "Freitag",
  6: "Samstag",
  7: "Sonntag",
};

export async function assertDayOpen(
  admin: SupabaseClient<Database>,
  locationId: string,
  shiftDate: string,
): Promise<void> {
  const [restRes, exRes] = await Promise.all([
    admin.from("location_rest_days").select("weekday").eq("location_id", locationId),
    admin
      .from("location_calendar_exceptions")
      .select("date, kind, reason")
      .eq("location_id", locationId)
      .eq("date", shiftDate)
      .maybeSingle(),
  ]);
  if (restRes.error) throw restRes.error;
  if (exRes.error) throw exRes.error;

  const restWeekdays = (restRes.data ?? []).map((r) => Number(r.weekday));
  const exceptions = new Map<string, CalendarExceptionKind>();
  if (exRes.data) {
    exceptions.set(exRes.data.date as string, exRes.data.kind as CalendarExceptionKind);
  }
  if (!isClosedDay(shiftDate, restWeekdays, exceptions)) return;

  const reason = (exRes.data?.reason as string | null) ?? null;
  const label =
    exRes.data?.kind === "closed"
      ? reason
        ? `Standort geschlossen (${reason})`
        : "Standort geschlossen"
      : `Ruhetag (${WEEKDAY_LABEL[isoWeekday(shiftDate)]})`;
  // KA3: fachliche Ablehnung — bewusst ValidationRejection, damit der zentrale
  // Sentry-Wrapper sie nicht als Serverfehler meldet. Prüf-Logik unverändert.
  throw new ValidationRejection(`${label}. Anlage an geschlossenen Tagen nicht möglich.`);
}
