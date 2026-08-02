// Reines Analytics-Modul für Modul M-BWA (Welle F2a).
//
// Ausschließlich pure Funktionen auf `BwaRow`-Zeilen aus `bwa.functions.ts`.
// Keine Netzaufrufe, keine React-Hooks, keine DB-Zugriffe.
//
// - `aggregateGroup(rows)`: fasst mehrere Kostenstellen einer entity/Monat-
//   Kombination elementweise zur virtuellen Kostenstelle "Gruppe" zusammen.
// - `sumRows(rows)`: elementweise Summe beliebig vieler Monate (Σ-Ansicht).
// - `deriveKpis(row)`: nutzt `deriveBwa` und ergänzt Quoten in Prozent.
// - `deltas(cur, prev)`: absolute und prozentuale Abweichung (oder null).
// - `buildWaterfall(row)`: GuV-Brücke mit Stacked-Bar-Sockel für Recharts.
// - `computeBreakEven(rows)`: rollierender Break-even inkl. echter USt-Mix-
//   Hochrechnung; bei ungültigem DB → null.

import { deriveBwa, type BwaDerived } from "./bwa-core";
import type { BwaRow } from "./bwa.functions";

/** Kalendarische Öffnungstage-Näherung. Kommentar: BWA-Kostenstellen sind
 *  aktuell nicht auf `locations` gemappt, daher konservativ 30 Tage/Monat. */
export const OPEN_DAYS_PER_MONTH = 30;

/** USt-Sätze (deutsche Gastronomie): 19 % Regel-, 7 % ermäßigt (Außer-Haus). */
export const VAT_STANDARD = 0.19;
export const VAT_REDUCED = 0.07;

/** Ab diesem Monat gilt der ermäßigte Satz (7 %) auch für Speisen IM Haus
 *  (bundesgesetzliche dauerhafte Senkung ab 01.01.2026; Getränke bleiben 19 %).
 *  Bauherren-Bestätigung + BWA-Beleg 02.08.2026. */
export const INHOUSE_FOOD_REDUCED_FROM = "2026-01";

/** True, wenn für den ISO-Monat (YYYY-MM-01 oder YYYY-MM) Haus-Speisen mit
 *  7 % zu bewerten sind. */
function inhouseFoodReduced(month: string): boolean {
  return month.slice(0, 7) >= INHOUSE_FOOD_REDUCED_FROM;
}

/** USt-Betrag einer einzelnen Monatszeile nach dem im Monat gültigen Recht. */
function monthVatCents(r: BwaRow): number {
  const reduced = inhouseFoodReduced(r.month);
  const rev19 =
    r.getraenkeCents + r.sonstigeErloeseCents + (reduced ? 0 : r.speisenHausCents);
  const rev7 = r.speisenAusserHausCents + (reduced ? r.speisenHausCents : 0);
  return rev19 * VAT_STANDARD + rev7 * VAT_REDUCED;
}

const CENT_KEYS = [
  "umsatzCents",
  "getraenkeCents",
  "speisenHausCents",
  "speisenAusserHausCents",
  "sonstigeErloeseCents",
  "sonstErtraegeCents",
  "wareneinsatzCents",
  "personalCents",
  "sachkostenCents",
  "anlageCents",
  "abschreibungCents",
  "betriebsergebnisCents",
] as const satisfies readonly (keyof BwaRow)[];

type CentKey = (typeof CENT_KEYS)[number];

function emptyCents(): Record<CentKey, number> {
  const o = {} as Record<CentKey, number>;
  for (const k of CENT_KEYS) o[k] = 0;
  return o;
}

/** Fasst alle Kostenstellen derselben `entity` + `month` zur virtuellen
 *  Kostenstelle "Gruppe" zusammen. `sachkosten_detail` wird bewusst ignoriert
 *  (F2b — Drilldown). Rückgabe ist ebenfalls `BwaRow`-kompatibel. */
export function aggregateGroup(rows: BwaRow[]): BwaRow[] {
  const buckets = new Map<string, BwaRow[]>();
  for (const r of rows) {
    const key = `${r.entity}__${r.month}`;
    const arr = buckets.get(key);
    if (arr) arr.push(r);
    else buckets.set(key, [r]);
  }
  const out: BwaRow[] = [];
  for (const [key, rs] of buckets) {
    const [entity, month] = key.split("__");
    const sum = emptyCents();
    for (const r of rs) for (const k of CENT_KEYS) sum[k] += r[k];
    out.push({
      id: `group__${entity}__${month}`,
      entity,
      costCenter: "Gruppe",
      month,
      ...sum,
      sachkostenDetail: null,
      source: "import",
    });
  }
  return out;
}

/** Elementweise Summe beliebig vieler Monatszeilen (nur Cent-Felder). */
export function sumRows(rows: BwaRow[]): Record<CentKey, number> {
  const s = emptyCents();
  for (const r of rows) for (const k of CENT_KEYS) s[k] += r[k];
  return s;
}

export type BwaKpis = BwaDerived & {
  personalQuote: number;
  wesQuote: number;
  primeCostQuote: number;
  rohertrag1Quote: number;
  betriebsQuote: number;
};

function pct(part: number, whole: number): number {
  if (whole === 0) return 0;
  return (part / whole) * 100;
}

export function deriveKpis(row: BwaRow): BwaKpis {
  const d = deriveBwa(row);
  return {
    ...d,
    personalQuote: pct(row.personalCents, row.umsatzCents),
    wesQuote: pct(row.wareneinsatzCents, row.umsatzCents),
    primeCostQuote: pct(row.wareneinsatzCents + row.personalCents, row.umsatzCents),
    rohertrag1Quote: pct(d.rohertrag1Cents, row.umsatzCents),
    betriebsQuote: pct(row.betriebsergebnisCents, row.umsatzCents),
  };
}

export type Delta = { absCents: number; pct: number | null };

/** Abweichung `cur - prev`; `pct` ist `null` bei prev==0. Ist `prev` selbst
 *  nicht vorhanden, gibt die Funktion `null` zurück (Aufrufer entscheidet). */
export function deltas(cur: number, prev: number | undefined): Delta | null {
  if (prev === undefined) return null;
  const absCents = cur - prev;
  const pctVal = prev === 0 ? null : (absCents / Math.abs(prev)) * 100;
  return { absCents, pct: pctVal };
}

export type WaterfallKind = "plus" | "minus" | "subtotal" | "total";
export type WaterfallStep = {
  label: string;
  valueCents: number; // Höhe des sichtbaren Balkens (immer >= 0)
  signedCents: number; // Original mit Vorzeichen (für Tabelle)
  kind: WaterfallKind;
  baseCents: number; // unsichtbarer Sockel für die Stacked-Bar-Technik
};

/** GuV-Brücke: Umsatz → +SonstErtr → −WES → RE I → −Personal → RE II →
 *  −Sachkosten → Ergebnis op. → −Anlage → −AfA → Betriebsergebnis.
 *  Für einen Recharts Stacked-Bar-Wasserfall: `base` (transparent) + `value`
 *  (sichtbar). Zwischen-/Endsummen starten bei 0 und tragen den vollen
 *  Positiv-/Negativwert. */
export function buildWaterfall(row: BwaRow): WaterfallStep[] {
  const d = deriveBwa(row);
  const steps: WaterfallStep[] = [];
  let running = 0;

  const add = (label: string, signed: number, kind: WaterfallKind) => {
    if (kind === "subtotal" || kind === "total") {
      steps.push({
        label,
        valueCents: Math.abs(signed),
        signedCents: signed,
        kind,
        baseCents: 0,
      });
      running = signed;
      return;
    }
    const next = running + signed;
    // Sockel = min(running, next), Balken-Höhe = |signed|
    const base = Math.min(running, next);
    steps.push({
      label,
      valueCents: Math.abs(signed),
      signedCents: signed,
      kind,
      baseCents: base,
    });
    running = next;
  };

  add("Umsatz", row.umsatzCents, "plus");
  add("Sonst. Erträge", row.sonstErtraegeCents, "plus");
  add("Wareneinsatz", -row.wareneinsatzCents, "minus");
  add("Rohertrag I", d.rohertrag1Cents, "subtotal");
  add("Personal", -row.personalCents, "minus");
  add("Rohertrag II", d.rohertrag2Cents, "subtotal");
  add("Sachkosten", -row.sachkostenCents, "minus");
  add("Ergebnis op.", d.ergebnisOpCents, "subtotal");
  add("Anlage", -row.anlageCents, "minus");
  add("Abschreibung", -row.abschreibungCents, "minus");
  add("Betriebsergebnis", row.betriebsergebnisCents, "total");

  return steps;
}

export type BreakEven = {
  v: number; // variabler Kostenanteil (WES/Umsatz)
  db: number; // Deckungsbeitragsquote (1 - v)
  factor: number; // Brutto-Faktor aus tatsächlichem USt-Mix
  /** USt-Faktor nach aktuellem Regelstand: Erlösmix NUR der Monate ab dem
   *  jüngsten Regelwechsel (>= INHOUSE_FOOD_REDUCED_FROM). null, wenn keine
   *  solchen Monate im Fenster liegen. */
  factorCurrent: number | null;
  months: number;
  netMonthCents: number;
  netDayCents: number;
  grossMonthCents: number;
  grossDayCents: number;
  actualDayCents: number;
  marginOfSafety: number; // (ΣUmsatz - bePeriod) / ΣUmsatz
};

/** Rollierender Break-even über bis zu 12 Monate. Fix-Block konservativ =
 *  Personal + Sachkosten + Anlage + Abschreibung; variabel = Wareneinsatz.
 *  USt-Faktor aus dem echten Erlös-Mix der übergebenen Monate, monatsgenau
 *  nach dem jeweils gültigen Satz für Haus-Speisen (siehe
 *  INHOUSE_FOOD_REDUCED_FROM).
 *
 *  Sortierung des Inputs ist egal — intern wird absteigend nach `month`
 *  sortiert; gerechnet werden die 12 NEUESTEN Monate. */
export function computeBreakEven(rows: BwaRow[]): BreakEven | null {
  if (rows.length === 0) return null;
  const sorted = [...rows].sort((a, b) => b.month.localeCompare(a.month));
  const last12 = sorted.slice(0, 12);
  const s = sumRows(last12);
  if (s.umsatzCents <= 0) return null;
  const v = s.wareneinsatzCents / s.umsatzCents;
  const db = 1 - v;
  if (db <= 0) return null;

  const fix =
    s.personalCents +
    s.sachkostenCents +
    s.anlageCents +
    s.abschreibungCents -
    s.sonstErtraegeCents;
  const bePeriodCents = fix / db;
  const months = last12.length;
  const netMonthCents = bePeriodCents / months;
  const netDayCents = netMonthCents / OPEN_DAYS_PER_MONTH;

  const rev19 = s.getraenkeCents + s.sonstigeErloeseCents + s.speisenHausCents;
  const rev7 = s.speisenAusserHausCents;
  const vat = rev19 * VAT_STANDARD + rev7 * VAT_REDUCED;
  const factor = (s.umsatzCents + vat) / s.umsatzCents;

  const grossMonthCents = netMonthCents * factor;
  const grossDayCents = netDayCents * factor;

  const actualDayCents = s.umsatzCents / months / OPEN_DAYS_PER_MONTH;
  const marginOfSafety = (s.umsatzCents - bePeriodCents) / s.umsatzCents;

  return {
    v,
    db,
    factor,
    months,
    netMonthCents: Math.round(netMonthCents),
    netDayCents: Math.round(netDayCents),
    grossMonthCents: Math.round(grossMonthCents),
    grossDayCents: Math.round(grossDayCents),
    actualDayCents: Math.round(actualDayCents),
    marginOfSafety,
  };
}

/** STAT3h — Modell-Ergebnis vor Steuern für einen Monat:
 *  `db × (grossRevenueCents / factor − netMonthCents)`.
 *
 *  `grossRevenueCents` ist der Kassenumsatz brutto des Monats; die Umrechnung
 *  auf netto läuft über den USt-Mix-Faktor des übergebenen Break-even. Oberhalb
 *  des Break-even trägt jeder Euro nur seinen Deckungsbeitrag, deshalb ist es
 *  NICHT die nackte Differenz Umsatz − BE. Negative Ergebnisse (Monat unter dem
 *  Break-even) werden bewusst zurückgegeben. `null` bei fehlendem BE. */
export function estimatedPreTaxResultCents(
  grossRevenueCents: number,
  be: BreakEven | null,
): number | null {
  if (be === null) return null;
  if (be.factor <= 0) return null;
  const netRevenue = grossRevenueCents / be.factor;
  return Math.round(be.db * (netRevenue - be.netMonthCents));
}

/** Findet zu einem ISO-Monat (YYYY-MM-01) den Vorjahresmonat im Bestand. */
export function findYoy<T extends { month: string }>(rows: T[], month: string): T | undefined {
  const y = Number(month.slice(0, 4));
  const prevMonth = `${y - 1}${month.slice(4)}`;
  return rows.find((r) => r.month === prevMonth);
}

/** Findet den vorherigen Monatserfassungspunkt (chronologisch direkt davor). */
export function findPrevMonth<T extends { month: string }>(
  rows: T[],
  month: string,
): T | undefined {
  const sorted = [...rows].sort((a, b) => a.month.localeCompare(b.month));
  const idx = sorted.findIndex((r) => r.month === month);
  if (idx <= 0) return undefined;
  return sorted[idx - 1];
}

// ============================================================================
// F2b: Sachkosten-Drilldown + Standortvergleich
// ============================================================================

export type SachkostenDetailSummary = {
  detail: Record<string, number>;
  coveredSachkostenCents: number;
  missingMonths: number;
};

/** Summiert `sachkostenDetail` label-weise über alle Zeilen. Zeilen ohne
 *  Detail werden als `missingMonths` gezählt; `coveredSachkostenCents` ist
 *  Σ `sachkostenCents` NUR der Zeilen MIT Detail (Abdeckungs-Hinweis). */
export function sumSachkostenDetail(rows: BwaRow[]): SachkostenDetailSummary {
  const detail: Record<string, number> = {};
  let coveredSachkostenCents = 0;
  let missingMonths = 0;
  for (const r of rows) {
    if (r.sachkostenDetail == null) {
      missingMonths += 1;
      continue;
    }
    coveredSachkostenCents += r.sachkostenCents;
    for (const [k, v] of Object.entries(r.sachkostenDetail)) {
      detail[k] = (detail[k] ?? 0) + v;
    }
  }
  return { detail, coveredSachkostenCents, missingMonths };
}

export type CostCenterComparison = {
  costCenter: string;
  kpis: BwaKpis;
  months: number;
};

export type CompareMetric = "personalQuote" | "wesQuote" | "primeCostQuote" | "betriebsQuote";

export type CostCenterCompareResult = {
  entries: CostCenterComparison[];
  bestByMetric: Partial<Record<CompareMetric, string>>;
  worstByMetric: Partial<Record<CompareMetric, string>>;
};

const COMPARE_METRICS: CompareMetric[] = [
  "personalQuote",
  "wesQuote",
  "primeCostQuote",
  "betriebsQuote",
];

/** Vergleicht die echten Kostenstellen (KEINE "Gruppe") einer entity über
 *  die übergebenen Monate. `bestByMetric`/`worstByMetric` je Quote: bei
 *  Quoten gilt niedriger = besser, außer `betriebsQuote` (höher = besser). */
export function compareCostCenters(rows: BwaRow[], months: string[]): CostCenterCompareResult {
  const monthSet = new Set(months);
  const buckets = new Map<string, BwaRow[]>();
  for (const r of rows) {
    if (r.costCenter === "Gruppe") continue;
    if (!monthSet.has(r.month)) continue;
    const arr = buckets.get(r.costCenter);
    if (arr) arr.push(r);
    else buckets.set(r.costCenter, [r]);
  }
  const entries: CostCenterComparison[] = [];
  for (const [costCenter, rs] of buckets) {
    const s = sumRows(rs);
    const synth: BwaRow = {
      id: `cmp__${costCenter}`,
      entity: rs[0].entity,
      costCenter,
      month: rs[0].month,
      ...s,
      sachkostenDetail: null,
      source: "import",
    };
    entries.push({ costCenter, kpis: deriveKpis(synth), months: rs.length });
  }
  entries.sort((a, b) => a.costCenter.localeCompare(b.costCenter));

  const bestByMetric: Partial<Record<CompareMetric, string>> = {};
  const worstByMetric: Partial<Record<CompareMetric, string>> = {};
  if (entries.length >= 2) {
    for (const m of COMPARE_METRICS) {
      const higherIsGood = m === "betriebsQuote";
      let best = entries[0];
      let worst = entries[0];
      for (const e of entries) {
        if (higherIsGood ? e.kpis[m] > best.kpis[m] : e.kpis[m] < best.kpis[m]) best = e;
        if (higherIsGood ? e.kpis[m] < worst.kpis[m] : e.kpis[m] > worst.kpis[m]) worst = e;
      }
      bestByMetric[m] = best.costCenter;
      worstByMetric[m] = worst.costCenter;
    }
  }
  return { entries, bestByMetric, worstByMetric };
}
