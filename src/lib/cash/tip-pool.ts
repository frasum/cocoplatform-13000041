// B4 — Trinkgeld-Pool: reine Rechenfunktion.
//
// Keine I/O. Inputs:
//   * kitchenPoolCents / servicePoolCents — bereits berechnete Pool-Summen
//   * settlements — aktive (nicht-superseded) Kellnerabrechnungen
//     (werden hier nicht erneut summiert; sie liefern nur staff-Liste/
//     Trinkgeld-Cent-Werte für etwaige Erweiterungen)
//   * timeEntries — geschlossene Zeiteinträge der Session
//     (nur ended_at != null wird gezählt)
//   * staffDepartments — staff_locations.department je Mitarbeiter
//     für den Session-Standort
//   * staffParticipates — staff.participates_in_pool je Mitarbeiter
//
// Verteilung pro Pool:
//   anteil = FLOOR(pool * eigene_stunden / gesamt_stunden) auf vollen EURO
//   (Vielfache von 100 Cent). Der Restcent bleibt im Pool / Tagesbargeld
//   (kein Trickle-Down, kein Ausgleich).
//
// GL ist aus beiden Pools ausgeschlossen. Nicht-teilnehmende
// Mitarbeiter ebenfalls. Leere Stunden → alle Anteile 0, Rest = Pool.

import type { StaffDepartment } from "@/lib/staff-domain";
export type { StaffDepartment };

// TG4 — Verteilmodus innerhalb eines Pools. Betrifft AUSSCHLIESSLICH die
// Aufteilung auf die bereits ermittelte Teilnehmerliste; wer teilnimmt
// (Mindeststunden, participates_in_pool, GL-Ausschluss) bleibt unberührt.
export type TipDistributionMode = "hours" | "headcount";

/**
 * Welcher Verteilmodus gilt an einem Geschäftstag?
 * Vor dem Stichtag und ohne Stichtag gilt immer "hours" — die Historie
 * bleibt dadurch exakt reproduzierbar (TG4, keine Rückwirkung).
 * Vergleich als String-Vergleich auf ISO-Datum (keine Zeitzonen-Falle).
 */
export function resolveTipDistributionMode(
  businessDate: string,
  mode: TipDistributionMode,
  modeFrom: string | null,
): TipDistributionMode {
  if (modeFrom === null) return "hours";
  return businessDate >= modeFrom ? mode : "hours";
}

/**
 * Effektive Pool-Teilnahme: Session-Übersteuerung schlägt den Stammdaten-Default,
 * vollständig entkoppelt von den Stunden. NULL = kein Override → Default.
 */
export function effectiveParticipation(
  override: boolean | null | undefined,
  staffDefault: boolean,
): boolean {
  return override ?? staffDefault;
}

export function computeTipTotalCents(
  settlements: Array<{
    cardTotalCents: number;
    cashHandedInCents: number;
    posSalesCents: number;
    openInvoicesCents: number;
    hilfMahlCents: number;
    /**
     * Abzugebender Betrag — Pool-Beitrag rechnet hierauf statt auf posSales.
     * Fallback auf posSalesCents, wenn nicht gesetzt (Backwards-Kompat).
     */
    kassiertBruttoCents?: number;
  }>,
): number {
  return settlements.reduce(
    // Angeglichen an Tagesabrechnung (16.06.2026):
    //   open_invoices wird wie Bargeld behandelt (addiert, nicht abgezogen),
    //   hilf_mahl wird zusätzlich abgezogen (Mitarbeiteressen mindert Trinkgeld).
    //   Verhindert künstlich negative Pools bei hohen offenen Rechnungen.
    // Pool-Beitrag = card + cashHandedIn + open − kassiertBrutto − hilfMahl.
    (s, x) =>
      s +
      x.cardTotalCents +
      x.cashHandedInCents +
      x.openInvoicesCents -
      (x.kassiertBruttoCents ?? x.posSalesCents) -
      x.hilfMahlCents,
    0,
  );
}

/**
 * Filtert eine Settlement-Liste auf aktive (nicht superseded) Zeilen.
 * Client-Aggregationen (Quote-Kachel, Finalize-Zusammenfassung) MÜSSEN
 * diesen Helfer nutzen — die getCashOverview-Liste enthält bewusst auch
 * superseded-Zeilen (Anzeige grau), sie dürfen aber nie in Summen fließen.
 */
export function activeSettlements<T extends { status?: string | null }>(
  list: ReadonlyArray<T>,
): T[] {
  return list.filter((s) => s.status !== "superseded");
}

export type TipPoolInput = {
  kitchenPoolCents: number;
  servicePoolCents: number;
  // TG4 — Pflichtfeld: jede Aufrufstelle muss den Modus bewusst wählen.
  distributionMode: TipDistributionMode;
  settlements: Array<{
    staffId: string;
    posSalesCents: number;
    cardTotalCents: number;
    openInvoicesCents: number;
    kitchenTipCents: number;
  }>;
  timeEntries: Array<{
    staffId: string;
    startedAt: string; // ISO
    endedAt: string; // ISO
  }>;
  staffDepartments: Map<string, StaffDepartment>;
  staffParticipates: Map<string, boolean>;
  // Mindeststunden pro Geschäftstag (Tagessumme). Mitarbeiter mit
  // weniger Stunden werden vor der Verteilung herausgefiltert. Grenze
  // ist inklusive: hours >= minHoursPerDay nimmt teil. Optional;
  // 0 oder undefined = keine Schwelle.
  minHoursPerDay?: number;
};

export type TipPoolShare = {
  staffId: string;
  department: "kitchen" | "service";
  hoursWorked: number; // Dezimal, 2 Stellen
  shareCents: number;
};

export type TipPoolResult = {
  kitchenPoolCents: number;
  servicePoolCents: number;
  kitchenRemainder: number;
  serviceRemainder: number;
  shares: TipPoolShare[];
  // Mitarbeiter, die wegen Unterschreitung der Mindeststunden vom Pool
  // ausgenommen wurden. Reine Diagnose, fließt nicht in shares ein.
  excludedByMinHours: Array<{
    staffId: string;
    department: "kitchen" | "service";
    hoursWorked: number;
  }>;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function distribute(
  poolCents: number,
  participants: Array<{ staffId: string; hours: number; department: "kitchen" | "service" }>,
): { shares: TipPoolShare[]; remainder: number } {
  if (!Number.isInteger(poolCents)) throw new Error("poolCents must be integer cents");
  const totalHours = participants.reduce((s, p) => s + p.hours, 0);
  if (poolCents <= 0 || totalHours <= 0) {
    return {
      shares: participants.map((p) => ({
        staffId: p.staffId,
        department: p.department,
        hoursWorked: round2(p.hours),
        shareCents: 0,
      })),
      remainder: poolCents,
    };
  }
  let distributed = 0;
  const shares: TipPoolShare[] = participants.map((p) => {
    const share = Math.floor((poolCents * p.hours) / totalHours / 100) * 100;
    distributed += share;
    return {
      staffId: p.staffId,
      department: p.department,
      hoursWorked: round2(p.hours),
      shareCents: share,
    };
  });
  return { shares, remainder: poolCents - distributed };
}

export function computeTipPool(input: TipPoolInput): TipPoolResult {
  const hoursByStaff = new Map<string, number>();
  for (const te of input.timeEntries) {
    if (!te.endedAt) continue;
    const ms = new Date(te.endedAt).getTime() - new Date(te.startedAt).getTime();
    if (!(ms > 0)) continue;
    hoursByStaff.set(te.staffId, (hoursByStaff.get(te.staffId) ?? 0) + ms / 3_600_000);
  }

  const staffIds = new Set<string>([
    ...hoursByStaff.keys(),
    ...input.settlements.map((s) => s.staffId),
  ]);

  const kitchen: Array<{ staffId: string; hours: number; department: "kitchen" }> = [];
  const service: Array<{ staffId: string; hours: number; department: "service" }> = [];
  const excludedByMinHours: TipPoolResult["excludedByMinHours"] = [];
  const minHours = input.minHoursPerDay && input.minHoursPerDay > 0 ? input.minHoursPerDay : 0;

  for (const staffId of staffIds) {
    if (input.staffParticipates.get(staffId) === false) continue;
    const dept = input.staffDepartments.get(staffId);
    if (dept !== "kitchen" && dept !== "service") continue;
    const hours = hoursByStaff.get(staffId) ?? 0;
    // Inklusive Grenze: 2,50 h zählt mit, 2,49 h nicht.
    if (minHours > 0 && hours < minHours) {
      excludedByMinHours.push({ staffId, department: dept, hoursWorked: round2(hours) });
      continue;
    }
    if (dept === "kitchen") kitchen.push({ staffId, hours, department: "kitchen" });
    else service.push({ staffId, hours, department: "service" });
  }

  const k = distribute(input.kitchenPoolCents, kitchen);
  const s = distribute(input.servicePoolCents, service);

  return {
    kitchenPoolCents: input.kitchenPoolCents,
    servicePoolCents: input.servicePoolCents,
    kitchenRemainder: k.remainder,
    serviceRemainder: s.remainder,
    shares: [...k.shares, ...s.shares],
    excludedByMinHours,
  };
}

// ------------------------------------------------------------------------
// Stunden-Auflösung für den Pool (Stempel + manuelle Overrides)
// ------------------------------------------------------------------------
//
// Reine Funktion: liefert die finale `timeEntries`-Liste, die computeTipPool
// konsumiert. Regeln:
//   * settlementOnly → Roh-Stempel werden ignoriert.
//   * Mitarbeiter mit manuellem Eintrag: Stempel verworfen, synthetischer
//     Eintrag aus hoursMinutes (keine Vermischung).
//   * kitchenManualOnly: jeder Stempel-Eintrag eines Mitarbeiters mit
//     department === 'kitchen' wird verworfen — auch ohne manuellen
//     Eintrag. Service-Stempel bleiben unberührt.

export type RawTimeEntry = {
  staffId: string;
  startedAt: string;
  endedAt: string;
};

export type ManualPoolEntry = {
  staffId: string;
  department: StaffDepartment;
  hoursMinutes: number;
};

export function resolvePoolTimeEntries(input: {
  rawTimeEntries: RawTimeEntry[];
  manualEntries: ManualPoolEntry[];
  staffDepartments: Map<string, StaffDepartment>;
  settlementOnly: boolean;
  kitchenManualOnly: boolean;
  businessDate: string; // YYYY-MM-DD — Basis für synthetische ISO-Stempel
}): RawTimeEntry[] {
  const manualIds = new Set(input.manualEntries.map((m) => m.staffId));
  const raw = input.settlementOnly ? [] : input.rawTimeEntries;
  const filtered = raw.filter((te) => {
    if (manualIds.has(te.staffId)) return false;
    if (input.kitchenManualOnly && input.staffDepartments.get(te.staffId) === "kitchen") {
      return false;
    }
    return true;
  });
  const out: RawTimeEntry[] = [...filtered];
  const base = new Date(input.businessDate + "T00:00:00Z").getTime();
  for (const m of input.manualEntries) {
    if (m.hoursMinutes <= 0) continue;
    out.push({
      staffId: m.staffId,
      startedAt: new Date(base).toISOString(),
      endedAt: new Date(base + m.hoursMinutes * 60_000).toISOString(),
    });
  }
  return out;
}

// ------------------------------------------------------------------------
// TG1 — Abschluss-Warnung: aktiver Pool, aber keine anrechenbaren Stunden.
// Rein funktional; UI ruft dies auf, um vor dem Finalisieren zu warnen.
// ------------------------------------------------------------------------

/**
 * Liefert true, wenn ein Pool Geld enthält (> 0 Cent) und gleichzeitig
 * keine anrechenbaren Minuten (≤ 0) vorliegen. Beides zusammen ist der
 * Fingerabdruck fehlender Stunden am Abschluss (Lehre 02.07.2026,
 * 423-€-Vorfall).
 */
export function poolNeedsHoursWarning(poolCents: number, totalEligibleMinutes: number): boolean {
  return poolCents > 0 && totalEligibleMinutes <= 0;
}

/**
 * Verteilungsnahe Variante der TG1-Warnung: warnt, wenn der jeweilige Pool
 * Geld enthält, das Verteilungs-Ergebnis aber 0 Cent zuweist (voller Pool
 * bleibt als Rest übrig). Zieht die Wahrheit aus derselben Quelle wie die
 * Auszahlung — deckt daher auch die Fälle ab, die
 * `poolNeedsHoursWarning` (aggregierte Minuten über beide Abteilungen)
 * übersieht: z. B. Küchen-Pool mit Geld, aber nur Service-Stunden, oder
 * `tip_pool_settlement_only`-Ausschluss trotz vorhandener Roh-Minuten
 * (Lehre 02.07.2026, 423-€-Vorfall).
 */
export function poolFullyUnallocated(poolCents: number, distributedCents: number): boolean {
  return poolCents > 0 && distributedCents <= 0;
}
