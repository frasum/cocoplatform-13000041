// UK2 — Reine Regeln der U/K-Tage-Erfassung (`lohn_absence_days`).
//
// Der LESEPFAD des Rechners bleibt unverändert (lohn-rechner.functions.ts
// liest die Zeile selbst und behandelt „keine Zeile" wie 0/0). Hier liegt
// ausschließlich die Schreib-Logik: Validierung (Spiegel der DB-CHECKs,
// laut VOR der DB) und der Upsert-Ablauf mit injizierten Zugriffen, damit
// er ohne DB testbar bleibt.

/** Spiegel des DB-CHECKs (0..31) — Fehler laut vor dem Insert. */
export const MAX_ABSENCE_TAGE = 31;

export type AbsenceDays = {
  urlaubTage: number;
  krankTage: number;
};

export type AbsenceDaysRow = {
  urlaub_tage: number | null;
  krank_tage: number | null;
};

/**
 * Neutralzustand: „keine Zeile" und „Zeile mit 0/0" sind identisch. Diese
 * Normalisierung spiegelt genau das, was der Rechner beim Lesen tut.
 */
export function absenceDaysFromRow(row: AbsenceDaysRow | null | undefined): AbsenceDays {
  return {
    urlaubTage: row?.urlaub_tage ?? 0,
    krankTage: row?.krank_tage ?? 0,
  };
}

function assertTage(label: string, value: number): void {
  if (!Number.isInteger(value)) {
    throw new Error(`${label}: nur ganze Tage erlaubt.`);
  }
  if (value < 0 || value > MAX_ABSENCE_TAGE) {
    throw new Error(`${label}: nur Werte zwischen 0 und ${MAX_ABSENCE_TAGE} erlaubt.`);
  }
}

export function assertAbsenceDaysRange(days: AbsenceDays): void {
  assertTage("Urlaubstage", days.urlaubTage);
  assertTage("Kranktage", days.krankTage);
}

export type SaveAbsenceDaysArgs = {
  staffId: string;
  periodStart: string;
  urlaubTage: number;
  krankTage: number;
};

export type SaveAbsenceDaysDeps = {
  /** true = `periodStart` ist Beginn einer bestehenden Abrechnungsperiode. */
  isPeriodStart: (periodStart: string) => Promise<boolean>;
  /** true = Mitarbeiter gehört zur Organisation des Callers. */
  isStaffInOrg: (staffId: string) => Promise<boolean>;
  loadExisting: (staffId: string, periodStart: string) => Promise<AbsenceDaysRow | null>;
  upsert: (values: SaveAbsenceDaysArgs) => Promise<void>;
};

export type SaveAbsenceDaysOutcome = {
  result: { ok: true; urlaubTage: number; krankTage: number };
  audit: {
    action: string;
    entity: string;
    meta: Record<string, unknown>;
  };
};

/**
 * Speichert die harten U/K-Tage einer Periode. Löschen = 0/0 speichern
 * (dokumentierter Neutralzustand, kein eigener Delete-Pfad).
 */
export async function saveAbsenceDaysCore(
  deps: SaveAbsenceDaysDeps,
  args: SaveAbsenceDaysArgs,
): Promise<SaveAbsenceDaysOutcome> {
  assertAbsenceDaysRange({ urlaubTage: args.urlaubTage, krankTage: args.krankTage });

  if (!(await deps.isStaffInOrg(args.staffId))) {
    throw new Error("Mitarbeiter nicht in dieser Organisation.");
  }
  if (!(await deps.isPeriodStart(args.periodStart))) {
    throw new Error(`${args.periodStart} ist kein Beginn einer Abrechnungsperiode.`);
  }

  const vorher = absenceDaysFromRow(await deps.loadExisting(args.staffId, args.periodStart));
  await deps.upsert(args);

  return {
    result: { ok: true, urlaubTage: args.urlaubTage, krankTage: args.krankTage },
    audit: {
      action: "lohn_absence_days.upsert",
      entity: "lohn_absence_days",
      meta: {
        staff_id: args.staffId,
        period_start: args.periodStart,
        von: { urlaub_tage: vorher.urlaubTage, krank_tage: vorher.krankTage },
        nach: { urlaub_tage: args.urlaubTage, krank_tage: args.krankTage },
      },
    },
  };
}
