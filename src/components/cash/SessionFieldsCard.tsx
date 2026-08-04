import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { fmtCents } from "@/lib/format";
import { parseEuroToCents, focusNextInput } from "@/lib/cash/kasse-helpers";
import type { Overview } from "@/lib/cash/kasse-types";
import { sessionHouseCentsFromKasse } from "@/lib/statistics/revenue-core";
import { resolveChannelKind } from "@/lib/cash/session-channels";
import { buildChannelKindMap } from "@/lib/cash/channel-mapping";
import { AdvanceForm } from "./AdvanceForm";
import { ExpenseForm } from "./ExpenseForm";
import { CashSummaryBlock } from "./CashSummaryBlock";
import { ExcelSectionHeader, ExcelInputRow, ExcelReadonlyRow } from "./ExcelRows";

type UpdatePayload = {
  channelAmounts: { channelId: string; amountCents: number }[];
  terminalAmounts: { terminalId: string; amountCents: number }[];
  vouchersSoldCents: number;
  vouchersRedeemedCents: number;
  /**
   * FS1: Am Standort deaktivierte Session-Felder werden NICHT mit 0 gesendet,
   * sondern WEGGELASSEN — der Server behandelt fehlende Felder als „nicht
   * anfassen", historische Werte können so nie genullt werden.
   */
  finedineVouchersCents?: number;
  vorschussCents: number;
  einladungCents: number;
  vectronDailyTotalCents: number;
  cashActualCents: number | null;
  guestCount: number;
  notes: string | null;
};

export function SessionFieldsCard({
  overview,
  channels,
  mappingChannels,
  channelsLoaded = true,
  terminals,
  writable,
  onSave,
  expenses,
  advances,
  otherIncomes,
  staff,
  onAddExpense,
  onRemoveExpense,
  onAddOtherIncome,
  onRemoveOtherIncome,
  onAddAdvance,
  onRemoveAdvance,
  cashBalanceTargetCents,
  kpiSlot,
  previousDeficitCents,
  previousDeficitSourceDate,
  locationName,
  tipRemainderCents,
  disabledSessionFields,
}: {
  sessionId: string;
  overview: Overview;
  channels: { id: string; label: string; kind: string; isActive: boolean }[];
  /**
   * CH1: ORG-WEITE Kanal-Landkarte (alle Standorte, aktiv+inaktiv) — dient
   * NUR der kind-Auflösung. Fehlt sie, wird auf `channels` zurückgefallen.
   */
  mappingChannels?: { id: string; kind: string }[];
  /**
   * KA1/CH1: `false`, solange der Mapping-Katalog noch nicht geladen ist. In dem
   * Fall wird die Haus-Umsatz-Berechnung NICHT ausgeführt (kein Rechnen auf
   * leerer Map), sondern als „–" angezeigt. Bei echtem Lookup-Miss (Katalog
   * geladen, ID unbekannt) wirft `resolveChannelKind` weiterhin mit ID.
   */
  channelsLoaded?: boolean;
  terminals: { id: string; label: string; isActive: boolean; isGl: boolean }[];
  writable: boolean;
  onSave: (data: UpdatePayload) => Promise<unknown>;
  expenses: Array<{ id: string; description: string | null; amountCents: number }>;
  /** SE1: sonstige Einnahmen als Positionsliste (Muster Ausgaben). */
  otherIncomes: Array<{ id: string; description: string; amountCents: number }>;
  advances: Array<{
    id: string;
    staffId: string;
    amountCents: number;
    note: string | null;
  }>;
  staff: { id: string; displayName: string }[];
  onAddExpense: (description: string, amountCents: number) => Promise<unknown>;
  onRemoveExpense: (id: string) => Promise<unknown>;
  onAddOtherIncome: (description: string, amountCents: number) => Promise<unknown>;
  onRemoveOtherIncome: (id: string) => Promise<unknown>;
  onAddAdvance: (staffId: string, amountCents: number, note: string | null) => Promise<unknown>;
  onRemoveAdvance: (id: string) => Promise<unknown>;
  cashBalanceTargetCents: number;
  kpiSlot?: React.ReactNode;
  previousDeficitCents: number;
  previousDeficitSourceDate: string | null;
  locationName?: string;
  tipRemainderCents: number;
}) {
  type Row = { id: string; euro: string };
  type TerminalRow = Row & { isGl: boolean };
  const initialChannels: Row[] = channels.map((c) => {
    const found = overview.channelAmounts.find((a) => a.channelId === c.id);
    return { id: c.id, euro: ((found?.amountCents ?? 0) / 100).toFixed(2) };
  });
  const initialTerminals: TerminalRow[] = terminals.map((t) => {
    const found = overview.terminalAmounts.find((a) => a.terminalId === t.id);
    return { id: t.id, euro: ((found?.amountCents ?? 0) / 100).toFixed(2), isGl: t.isGl };
  });

  const sess = overview.session!;
  type Misc = {
    vouchersSold: string;
    vouchersRedeemed: string;
    finedineVouchers: string;
    vorschuss: string;
    einladung: string;
    vectron: string;
    cashActual: string;
    guestCount: string;
    notes: string;
  };
  const initialMisc: Misc = {
    vouchersSold: (Number(sess.vouchers_sold_cents ?? 0) / 100).toFixed(2),
    vouchersRedeemed: (Number(sess.vouchers_redeemed_cents ?? 0) / 100).toFixed(2),
    finedineVouchers: (Number(sess.finedine_vouchers_cents ?? 0) / 100).toFixed(2),
    vorschuss: (Number(sess.vorschuss_cents ?? 0) / 100).toFixed(2),
    einladung: (Number(sess.einladung_cents ?? 0) / 100).toFixed(2),
    vectron: (Number(sess.vectron_daily_total_cents ?? 0) / 100).toFixed(2),
    cashActual:
      sess.cash_actual_cents === null || sess.cash_actual_cents === undefined
        ? ""
        : (Number(sess.cash_actual_cents) / 100).toFixed(2),
    guestCount: String((sess as { guest_count?: number | null }).guest_count ?? 0),
    notes: sess.notes ?? "",
  };

  const [chRows, setChRows] = useState<Row[]>(initialChannels);
  const [tmRows, setTmRows] = useState<TerminalRow[]>(initialTerminals);
  const [misc, setMisc] = useState<Misc>(initialMisc);
  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [autoSaveError, setAutoSaveError] = useState<string | null>(null);
  const lastSavedSnapshotRef = useRef<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextAutoSaveRef = useRef<boolean>(true);
  const pendingPayloadRef = useRef<UpdatePayload | null>(null);

  // Wenn neue Reads kommen, lokale State zurücksetzen.
  useEffect(() => {
    setChRows(initialChannels);
    setTmRows(initialTerminals);
    setMisc(initialMisc);
    // Nach externem Refresh: aktuellen Server-State als „gespeichert" markieren
    // und den nächsten Auto-Save überspringen (sonst feuert er sofort wieder).
    skipNextAutoSaveRef.current = true;
    // Snapshot wird im Auto-Save-Effekt unten neu gesetzt.
    lastSavedSnapshotRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overview.session?.id]);

  function build(): UpdatePayload | null {
    const chAmts: { channelId: string; amountCents: number }[] = [];
    for (const r of chRows) {
      const c = parseEuroToCents(r.euro);
      if (c === null) return null;
      if (c !== 0) chAmts.push({ channelId: r.id, amountCents: c });
    }
    const tmAmts: { terminalId: string; amountCents: number }[] = [];
    for (const r of tmRows) {
      const c = parseEuroToCents(r.euro);
      if (c === null) return null;
      if (c !== 0) tmAmts.push({ terminalId: r.id, amountCents: c });
    }
    const vs = parseEuroToCents(misc.vouchersSold);
    const vr = parseEuroToCents(misc.vouchersRedeemed);
    const fv = parseEuroToCents(misc.finedineVouchers);
    const vo = parseEuroToCents(misc.vorschuss);
    const ei = parseEuroToCents(misc.einladung);
    const ve = parseEuroToCents(misc.vectron);
    const caRaw = misc.cashActual.trim();
    const caParsed = caRaw === "" ? null : parseEuroToCents(caRaw);
    const gcRaw = misc.guestCount.trim();
    const gcParsed = gcRaw === "" ? 0 : Number.parseInt(gcRaw, 10);
    if (
      vs === null ||
      vr === null ||
      fv === null ||
      vo === null ||
      ei === null ||
      ve === null ||
      (caRaw !== "" && caParsed === null) ||
      !Number.isFinite(gcParsed) ||
      gcParsed < 0
    )
      return null;
    return {
      channelAmounts: chAmts,
      terminalAmounts: tmAmts,
      vouchersSoldCents: vs,
      vouchersRedeemedCents: vr,
      finedineVouchersCents: fv,
      vorschussCents: vo,
      einladungCents: ei,
      vectronDailyTotalCents: ve,
      cashActualCents: caParsed,
      guestCount: gcParsed,
      notes: misc.notes.trim() === "" ? null : misc.notes,
    };
  }

  async function handleSave() {
    const payload = build();
    if (!payload) {
      toast.error("Bitte alle Beträge als Euro eingeben.");
      return;
    }
    setSaving(true);
    try {
      await onSave(payload);
      lastSavedSnapshotRef.current = JSON.stringify(payload);
      setLastSavedAt(new Date());
      setAutoSaveError(null);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  // ── Auto-Save: nach 800 ms Stille gültigen Payload persistieren ──
  useEffect(() => {
    if (!writable) return;
    const payload = build();
    if (!payload) {
      pendingPayloadRef.current = null;
      setAutoSaveError("Eingabe ungültig");
      return;
    }
    const snap = JSON.stringify(payload);
    if (skipNextAutoSaveRef.current) {
      skipNextAutoSaveRef.current = false;
      lastSavedSnapshotRef.current = snap;
      return;
    }
    if (snap === lastSavedSnapshotRef.current) return;
    pendingPayloadRef.current = payload;
    setAutoSaveError(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const p = pendingPayloadRef.current;
      if (!p) return;
      setSaving(true);
      try {
        await onSave(p);
        lastSavedSnapshotRef.current = JSON.stringify(p);
        setLastSavedAt(new Date());
        setAutoSaveError(null);
      } catch (e) {
        setAutoSaveError((e as Error).message);
      } finally {
        setSaving(false);
      }
    }, 800);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chRows, tmRows, misc, writable]);

  // Warnung beim Schließen, falls noch ungespeicherte Änderungen pendieren
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      const payload = pendingPayloadRef.current;
      if (payload && JSON.stringify(payload) !== lastSavedSnapshotRef.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  const saveStatusLabel = saving
    ? "Speichert…"
    : autoSaveError
      ? "Speichern fehlgeschlagen — erneut versuchen"
      : lastSavedAt
        ? `Automatisch gespeichert · ${lastSavedAt.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}`
        : "Auto-Save aktiv";

  // CH1: Map aus der org-weiten Landkarte — alle Standorte, aktiv+inaktiv
  // (Standort-Race CH1). Lookup-Miss wirft in `resolveChannelKind` mit ID.
  const channelById = Object.fromEntries(channels.map((c) => [c.id, c]));
  const channelKindById = buildChannelKindMap(mappingChannels ?? channels);
  const terminalById = Object.fromEntries(terminals.map((t) => [t.id, t]));
  const posRows = chRows.filter((r) => channelById[r.id]?.kind === "pos");
  const delivRows = chRows.filter((r) => channelById[r.id]?.kind?.startsWith("delivery_"));

  const posEuroTotal = posRows.reduce((s, r) => s + (parseEuroToCents(r.euro) ?? 0), 0);
  const delivEuroTotal = delivRows.reduce((s, r) => s + (parseEuroToCents(r.euro) ?? 0), 0);
  const takeawayPct =
    posEuroTotal > 0
      ? new Intl.NumberFormat("de-DE", {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        }).format((delivEuroTotal / posEuroTotal) * 100) + " %"
      : null;

  const guestNum = parseInt(misc.guestCount || "0", 10);
  // N14 (Fachentscheidung Frank 13.07.): ⌀ pro Gast IMMER auf Haus-Umsatz —
  // Nenner (Gäste) zählt nur Im-Haus-Gäste, also gehört Wolt/SoUse/eigener
  // Außer-Haus-Verkauf raus. Gemeinsamer Helfer mit PDF + Druckansicht,
  // damit Bildschirm, PDF und Druck garantiert dieselbe Zahl zeigen.
  // KA1: Nur rechnen, wenn der Kanal-Katalog geladen ist. Sonst würde die
  // Auflösung gegen eine leere Map laufen und für jede bestehende
  // channelAmount-Zeile werfen (Lade-Rennen).
  const houseCentsForAvg = channelsLoaded
    ? sessionHouseCentsFromKasse({
        vectronCents: parseEuroToCents(misc.vectron) ?? 0,
        channels: chRows.map((r) => ({
          kind: resolveChannelKind(channelKindById, r.id),
          amountCents: parseEuroToCents(r.euro) ?? 0,
        })),
      })
    : null;
  const avgPerGuest =
    channelsLoaded && houseCentsForAvg != null && guestNum > 0 && houseCentsForAvg > 0
      ? fmtCents(Math.round(houseCentsForAvg / guestNum)) + " €"
      : null;

  const staffName = (id: string) => staff.find((s) => s.id === id)?.displayName ?? id.slice(0, 8);

  return (
    <div className="space-y-4">
      <div className="grid lg:grid-cols-[minmax(320px,2fr)_minmax(400px,3fr)] gap-4">
        {/* ── LEFT COLUMN ── */}
        <div className="border rounded-lg overflow-hidden shadow-sm">
          <ExcelSectionHeader label="Umsatz" colorClass="border-l-primary" />
          <table className="w-full text-sm">
            <tbody>
              {posRows.map((r) => (
                <ExcelInputRow
                  key={r.id}
                  label={channelById[r.id]?.label ?? r.id}
                  value={r.euro}
                  disabled={!writable}
                  onChange={(v) => {
                    const next = [...chRows];
                    const i = chRows.findIndex((x) => x.id === r.id);
                    next[i] = { ...r, euro: v };
                    setChRows(next);
                  }}
                />
              ))}
              <ExcelInputRow
                label="Vectron Tagesumsatz (Kontrolle)"
                value={misc.vectron}
                disabled={!writable}
                onChange={(v) => setMisc({ ...misc, vectron: v })}
              />
              <tr className="border-b last:border-b-0 hover:bg-muted/20 transition-colors">
                <td className="px-3 py-1.5 font-medium text-foreground">
                  Gästeanzahl
                  {avgPerGuest && (
                    <span className="ml-2 text-xs text-muted-foreground whitespace-nowrap">
                      ⌀ pro Gast (Haus) {avgPerGuest}
                    </span>
                  )}
                </td>
                <td className="px-3 py-1.5 w-36">
                  <Input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={misc.guestCount}
                    placeholder="0"
                    onChange={(e) =>
                      setMisc({
                        ...misc,
                        guestCount: e.target.value.replace(/\D/g, ""),
                      })
                    }
                    onFocus={(e) => e.currentTarget.select()}
                    onMouseUp={(e) => e.preventDefault()}
                    onClick={(e) => e.currentTarget.select()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        focusNextInput(e.currentTarget);
                      }
                    }}
                    className="h-7 text-sm text-right font-mono border-primary/20 bg-primary/5"
                    disabled={!writable}
                  />
                </td>
              </tr>
            </tbody>
          </table>

          <ExcelSectionHeader label="Kreditkarten" colorClass="border-l-amber-500" />
          <table className="w-full text-sm">
            <tbody>
              {tmRows.map((r, idx) => (
                <ExcelInputRow
                  key={r.id}
                  label={terminalById[r.id]?.label ?? r.id}
                  value={r.euro}
                  disabled={!writable}
                  onChange={(v) => {
                    const next = [...tmRows];
                    next[idx] = { ...r, euro: v };
                    setTmRows(next);
                  }}
                />
              ))}
            </tbody>
          </table>

          <div className="bg-muted/50 px-3 py-2 border-y border-l-4 border-l-emerald-500 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Take Away
            </span>
            {takeawayPct && (
              <span className="text-xs text-muted-foreground tabular-nums">{takeawayPct}</span>
            )}
          </div>
          <table className="w-full text-sm">
            <tbody>
              {delivRows.map((r) => (
                <ExcelInputRow
                  key={r.id}
                  label={channelById[r.id]?.label ?? r.id}
                  value={r.euro}
                  disabled={!writable}
                  onChange={(v) => {
                    const next = [...chRows];
                    const i = chRows.findIndex((x) => x.id === r.id);
                    next[i] = { ...r, euro: v };
                    setChRows(next);
                  }}
                />
              ))}
            </tbody>
          </table>

          <ExcelSectionHeader label="Gutscheine & Sonstiges" colorClass="border-l-violet-500" />
          <table className="w-full text-sm">
            <tbody>
              <ExcelInputRow
                label="Gutscheine verkauft"
                value={misc.vouchersSold}
                disabled={!writable}
                onChange={(v) => setMisc({ ...misc, vouchersSold: v })}
              />
              <ExcelInputRow
                label="Gutscheine eingelöst"
                value={misc.vouchersRedeemed}
                disabled={!writable}
                onChange={(v) => setMisc({ ...misc, vouchersRedeemed: v })}
              />
              {locationName !== "YUM" && (
                <ExcelInputRow
                  label="Finedine-Gutscheine"
                  value={misc.finedineVouchers}
                  disabled={!writable}
                  onChange={(v) => setMisc({ ...misc, finedineVouchers: v })}
                />
              )}
              <ExcelInputRow
                label="Einladung (Abzug)"
                value={misc.einladung}
                disabled={!writable}
                onChange={(v) => setMisc({ ...misc, einladung: v })}
              />
              {/* SE1: „Sonstige Einnahme" ist keine Eingabezeile mehr, sondern
                  eine Positionskarte in der rechten Spalte (Muster Ausgaben). */}
              {(() => {
                const advSum = advances.reduce((s, a) => s + a.amountCents, 0);
                const effVorschussCents =
                  advances.length > 0 ? advSum : (parseEuroToCents(misc.vorschuss) ?? 0);
                const totalExpensesCents = expenses.reduce((s, e) => s + e.amountCents, 0);
                const totalOtherIncomeCents = otherIncomes.reduce((s, o) => s + o.amountCents, 0);
                return (
                  <>
                    {effVorschussCents !== 0 && (
                      <ExcelReadonlyRow
                        label="Vorschuss (Abzug)"
                        value={fmtCents(effVorschussCents)}
                      />
                    )}
                    {totalExpensesCents !== 0 && (
                      <ExcelReadonlyRow
                        label="Ausgaben (Abzug)"
                        value={fmtCents(totalExpensesCents)}
                      />
                    )}
                    {totalOtherIncomeCents !== 0 && (
                      <ExcelReadonlyRow
                        label="Sonstige Einnahmen"
                        value={fmtCents(totalOtherIncomeCents)}
                      />
                    )}
                  </>
                );
              })()}
            </tbody>
          </table>

          <ExcelSectionHeader label="Kontrolle" colorClass="border-l-muted-foreground" />
          <CashSummaryBlock
            misc={misc}
            writable={writable}
            chRows={chRows}
            channelById={channelById}
            tmRows={tmRows}
            expenses={expenses}
            otherIncomes={otherIncomes}
            advances={advances}
            overview={overview}
            cashBalanceTargetCents={cashBalanceTargetCents}
            previousDeficitCents={previousDeficitCents}
            previousDeficitSourceDate={previousDeficitSourceDate}
            tipRemainderCents={tipRemainderCents}
          />
        </div>

        {/* ── RIGHT COLUMN ── */}
        <div className="space-y-4">
          <div className="border rounded-lg overflow-hidden">
            <div className="bg-muted/50 px-3 py-2 border-b">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Nachricht / Besonderheiten / Probleme
              </span>
            </div>
            <div className="p-3">
              <Textarea
                placeholder="Hinweise für die Chefin…"
                value={misc.notes}
                onChange={(e) => setMisc({ ...misc, notes: e.target.value })}
                rows={4}
                className="border-0 bg-transparent p-0 focus-visible:ring-0 resize-none"
                disabled={!writable}
              />
            </div>
          </div>

          <div className="border rounded-lg overflow-hidden">
            <div className="bg-muted/50 px-3 py-2 border-b">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Ausgaben
              </span>
            </div>
            <div className="p-3 space-y-2">
              {expenses.length === 0 ? (
                <p className="text-xs text-muted-foreground">Keine Ausgaben.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {expenses.map((e) => (
                    <li key={e.id} className="flex items-center justify-between gap-2">
                      <span className="flex-1 truncate">{e.description ?? "—"}</span>
                      <span className="font-mono tabular-nums">{fmtCents(e.amountCents)} €</span>
                      {writable && (
                        <button
                          className="text-destructive hover:opacity-70 text-xs"
                          onClick={() => void onRemoveExpense(e.id)}
                        >
                          ✕
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {writable && <ExpenseForm writable={writable} onAdd={onAddExpense} />}
            </div>
          </div>

          {/* SE1: SONSTIGE EINNAHMEN — zwischen „Ausgaben" und „Vorschüsse",
              Interaktion identisch zur Ausgaben-Karte. */}
          <div className="border rounded-lg overflow-hidden">
            <div className="bg-muted/50 px-3 py-2 border-b">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Sonstige Einnahmen
              </span>
            </div>
            <div className="p-3 space-y-2">
              {otherIncomes.length === 0 ? (
                <p className="text-xs text-muted-foreground">Keine sonstigen Einnahmen.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {otherIncomes.map((o) => (
                    <li key={o.id} className="flex items-center justify-between gap-2">
                      <span className="flex-1 truncate">{o.description}</span>
                      <span className="font-mono tabular-nums">{fmtCents(o.amountCents)} €</span>
                      {writable && (
                        <button
                          className="text-destructive hover:opacity-70 text-xs"
                          onClick={() => void onRemoveOtherIncome(o.id)}
                        >
                          ✕
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {writable && <ExpenseForm writable={writable} onAdd={onAddOtherIncome} />}
            </div>
          </div>

          <div className="border rounded-lg overflow-hidden">
            <div className="bg-muted/50 px-3 py-2 border-b">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Vorschüsse
              </span>
            </div>
            <div className="p-3 space-y-2">
              {advances.length === 0 ? (
                <p className="text-xs text-muted-foreground">Keine Vorschüsse.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {advances.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-2">
                      <span className="flex-1 truncate">
                        {staffName(a.staffId)}
                        {a.note ? ` · ${a.note}` : ""}
                      </span>
                      <span className="font-mono tabular-nums">{fmtCents(a.amountCents)} €</span>
                      {writable && (
                        <button
                          className="text-destructive hover:opacity-70 text-xs"
                          onClick={() => void onRemoveAdvance(a.id)}
                        >
                          ✕
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {writable && <AdvanceForm writable={writable} staff={staff} onAdd={onAddAdvance} />}
            </div>
          </div>

          {kpiSlot ? <div className="mt-4">{kpiSlot}</div> : null}
        </div>
      </div>

      <div className="flex justify-end gap-3">
        {!writable && (
          <p className="text-xs text-muted-foreground self-center">
            Schreibgeschützt (Session ist {sess.status}).
          </p>
        )}
        {writable && (
          <p
            className={`text-xs self-center ${autoSaveError ? "text-destructive" : "text-muted-foreground"}`}
            aria-live="polite"
          >
            {saveStatusLabel}
            {autoSaveError && (
              <>
                {" "}
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  Erneut versuchen
                </button>
              </>
            )}
          </p>
        )}
      </div>
    </div>
  );
}
