// Reines Diff-Modul für den Änderungs-Log der Tagesabrechnung.
//
// Vergleicht den Zustand VOR dem Speichern mit dem Zustand NACHHER und
// liefert nur die tatsächlich betroffenen Felder. Keine DB, keine Formatierung
// von Geld — Cents bleiben Cents; die Darstellung entscheidet die UI.
// Kanal-/Terminal-Labels werden mitgeführt (Snapshot), damit die Historie auch
// nach späteren Umbenennungen lesbar bleibt.

export type SessionAmountEntry = {
  id: string;
  label: string;
  amountCents: number;
};

export type SessionSnapshot = {
  vouchersSoldCents: number;
  vouchersRedeemedCents: number;
  finedineVouchersCents: number;
  vorschussCents: number;
  einladungCents: number;
  vectronDailyTotalCents: number;
  cashActualCents: number | null;
  guestCount: number;
  notes: string | null;
  channelAmounts: SessionAmountEntry[];
  terminalAmounts: SessionAmountEntry[];
};

export type SessionFieldChange = {
  /** Stabiler Schlüssel, z.B. `guest_count` oder `channel:<uuid>`. */
  field: string;
  /** Anzeigename zum Zeitpunkt der Änderung. */
  label: string;
  kind: "money" | "count" | "text";
  before: number | string | null;
  after: number | string | null;
};

const MONEY_FIELDS: { key: keyof SessionSnapshot; field: string; label: string }[] = [
  { key: "vouchersSoldCents", field: "vouchers_sold_cents", label: "Gutscheine verkauft" },
  { key: "vouchersRedeemedCents", field: "vouchers_redeemed_cents", label: "Gutscheine eingelöst" },
  { key: "finedineVouchersCents", field: "finedine_vouchers_cents", label: "Finedine-Gutscheine" },
  { key: "vorschussCents", field: "vorschuss_cents", label: "Vorschuss" },
  { key: "einladungCents", field: "einladung_cents", label: "Einladung" },
  { key: "vectronDailyTotalCents", field: "vectron_daily_total_cents", label: "Vectron-Tagesumsatz" },
  { key: "cashActualCents", field: "cash_actual_cents", label: "Bargeld gezählt" },
];

function amountMap(entries: SessionAmountEntry[]): Map<string, SessionAmountEntry> {
  const m = new Map<string, SessionAmountEntry>();
  for (const e of entries) m.set(e.id, e);
  return m;
}

function diffAmounts(
  prefix: "channel" | "terminal",
  before: SessionAmountEntry[],
  after: SessionAmountEntry[],
): SessionFieldChange[] {
  const beforeMap = amountMap(before);
  const afterMap = amountMap(after);
  const ids = [...new Set([...before.map((e) => e.id), ...after.map((e) => e.id)])];
  const out: SessionFieldChange[] = [];
  for (const id of ids) {
    const b = beforeMap.get(id);
    const a = afterMap.get(id);
    const beforeCents = b ? b.amountCents : null;
    const afterCents = a ? a.amountCents : null;
    if (beforeCents === afterCents) continue;
    out.push({
      field: `${prefix}:${id}`,
      label: a?.label ?? b?.label ?? id.slice(0, 8),
      kind: "money",
      before: beforeCents,
      after: afterCents,
    });
  }
  return out;
}

export function diffSessionSnapshot(
  before: SessionSnapshot,
  after: SessionSnapshot,
): SessionFieldChange[] {
  const changes: SessionFieldChange[] = [];

  for (const f of MONEY_FIELDS) {
    const b = before[f.key] as number | null;
    const a = after[f.key] as number | null;
    if (b === a) continue;
    changes.push({ field: f.field, label: f.label, kind: "money", before: b, after: a });
  }

  if (before.guestCount !== after.guestCount) {
    changes.push({
      field: "guest_count",
      label: "Gäste",
      kind: "count",
      before: before.guestCount,
      after: after.guestCount,
    });
  }

  const notesBefore = before.notes ?? null;
  const notesAfter = after.notes ?? null;
  if (notesBefore !== notesAfter) {
    changes.push({
      field: "notes",
      label: "Notiz",
      kind: "text",
      before: notesBefore,
      after: notesAfter,
    });
  }

  changes.push(...diffAmounts("channel", before.channelAmounts, after.channelAmounts));
  changes.push(...diffAmounts("terminal", before.terminalAmounts, after.terminalAmounts));

  return changes;
}
