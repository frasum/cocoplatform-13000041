// B3c-1b — Kellner-Abrechnung (mobil).
//
// Reiner UI-Commit auf den B3b/B3c-1a Server-Functions. Keine neue
// Geschäftslogik. Live-Vorschau über das gleiche reine Modul
// `calcWaiterSettlement` (Source-of-Truth bleibt der Server-Snapshot).

import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getMySettlement, submitWaiterSettlement } from "@/lib/cash/cash.functions";
import { useAuth } from "@/hooks/use-auth";
import { calcWaiterSettlement } from "@/lib/cash/waiter-settlement";
import { SecondWaiterSelect } from "@/components/cash/SecondWaiterSelect";
import { parseEuroToCents as parseEuroToCentsBase } from "@/lib/format";
import type { OpenInvoiceEntry } from "@/lib/cash/open-invoices";

export const Route = createFileRoute("/_authenticated/zeit/abrechnung")({
  head: () => ({
    meta: [
      { title: "Abrechnung" },
      { name: "description", content: "Kellner-Abrechnung des Geschäftstags" },
    ],
  }),
  component: AbrechnungPage,
});

// Euro-Eingabe → ganze Cents (akzeptiert "12", "12,50", "12.50", "1.234,56").
function parseEuroToCents(value: string): number | null {
  return parseEuroToCentsBase(value, { emptyAs: 0 });
}

function formatCents(cents: number | null | undefined): string {
  const v = (cents ?? 0) / 100;
  return v.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}

type FormState = {
  posSales: string;
  kassiertBrutto: string;
  cardTotal: string;
  hilfMahl: string;
  openInvoices: Array<{ name: string; amount: string }>;
  cashHandedIn: string;
  partnerStaffIds: string[];
};

const EMPTY_FORM: FormState = {
  posSales: "",
  kassiertBrutto: "",
  cardTotal: "",
  hilfMahl: "",
  openInvoices: [],
  cashHandedIn: "",
  partnerStaffIds: [],
};

function AbrechnungPage() {
  const qc = useQueryClient();
  const fetchMy = useServerFn(getMySettlement);
  const doSubmit = useServerFn(submitWaiterSettlement);
  const { identity } = useAuth();
  const canOpenSession = identity?.role === "admin" || identity?.role === "manager";

  const myQ = useQuery({
    queryKey: ["cash", "my-settlement"],
    queryFn: () => fetchMy(),
  });

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // KA3 — Rückfrage bei Fremd-/Geisterabgabe (dreifach-negative Plausibilität).
  const [foreignOpen, setForeignOpen] = useState(false);

  const parsed = useMemo(() => {
    const posSalesCents = parseEuroToCents(form.posSales);
    // „Abzugebender Betrag" ist optional: leeres Feld → Fallback auf Leistung (POS).
    const kassiertRaw = form.kassiertBrutto.trim();
    const kassiertBruttoCents =
      kassiertRaw === "" ? posSalesCents : parseEuroToCents(form.kassiertBrutto);
    // Offene Rechnungen: Liste aus (Name, Euro). Jede Zeile mit Betrag > 0
    // braucht einen nicht-leeren Namen; sonst blockt der Absende-Button.
    const openInvoiceRows = form.openInvoices.map((r) => {
      const name = r.name.trim();
      const cents = r.amount.trim() === "" ? 0 : parseEuroToCents(r.amount);
      const valid =
        cents !== null && cents >= 0 && (cents === 0 || name.length > 0) && name.length <= 120;
      return { name, cents, valid };
    });
    const openInvoiceEntries: OpenInvoiceEntry[] = openInvoiceRows
      .filter((r) => r.valid && r.cents !== null && r.cents > 0)
      .map((r) => ({ name: r.name, cents: r.cents as number }));
    const openInvoicesCents = openInvoiceEntries.reduce((s, r) => s + r.cents, 0);
    const openInvoicesAllValid = openInvoiceRows.every((r) => r.valid);
    return {
      posSalesCents,
      kassiertBruttoCents,
      cardTotalCents: parseEuroToCents(form.cardTotal),
      hilfMahlCents: parseEuroToCents(form.hilfMahl),
      openInvoicesCents,
      openInvoiceEntries,
      openInvoiceRows,
      openInvoicesAllValid,
      cashHandedInCents: parseEuroToCents(form.cashHandedIn),
    };
  }, [form]);

  // Negative Eingabe explizit erkennen, damit eine konkrete Fehlermeldung möglich ist
  // (parseEuroToCents lehnt negative Werte mit `null` ab — sonst nicht von „kein Eurobetrag" unterscheidbar).
  const kassiertBruttoNegative = form.kassiertBrutto.trim().startsWith("-");

  const allValid =
    parsed.posSalesCents !== null &&
    parsed.kassiertBruttoCents !== null &&
    !kassiertBruttoNegative &&
    parsed.cardTotalCents !== null &&
    parsed.hilfMahlCents !== null &&
    parsed.openInvoicesAllValid &&
    parsed.cashHandedInCents !== null;

  const preview = useMemo(() => {
    if (!allValid || myQ.data == null) return null;
    return calcWaiterSettlement({
      posSalesCents: parsed.posSalesCents!,
      kassiertBruttoCents: parsed.kassiertBruttoCents!,
      cardTotalCents: parsed.cardTotalCents!,
      hilfMahlCents: parsed.hilfMahlCents!,
      openInvoicesCents: parsed.openInvoicesCents!,
      kitchenTipRate: myQ.data.kitchenTipRate,
    });
  }, [allValid, parsed, myQ.data]);

  // Brutto-Trinkgeld-Quote (Küche eingerechnet) = (abgegebenes Bargeld − Differenz) / Leistung.
  // `preview` ist nur != null, wenn alle Felder valide sind → parsed-Werte sind dann gesetzt.
  const previewTipPct =
    preview && parsed.posSalesCents! > 0
      ? ((parsed.cashHandedInCents! - preview.differenzCents) / parsed.posSalesCents!) * 100
      : null;

  const submitMut = useMutation({
    mutationFn: (opts?: { confirmedForeign?: boolean }) => {
      if (!allValid) throw new Error("Bitte alle Felder als Eurobetrag eintragen.");
      return doSubmit({
        data: {
          posSalesCents: parsed.posSalesCents!,
          kassiertBruttoCents: parsed.kassiertBruttoCents!,
          cardTotalCents: parsed.cardTotalCents!,
          hilfMahlCents: parsed.hilfMahlCents!,
          openInvoicesCents: parsed.openInvoicesCents,
          openInvoiceEntries: parsed.openInvoiceEntries,
          cashHandedInCents: parsed.cashHandedInCents!,
          partnerStaffIds: form.partnerStaffIds.filter(Boolean),
          ...(opts?.confirmedForeign ? { confirmedForeign: true } : {}),
        },
      });
    },
    onSuccess: (res) => {
      setConfirmOpen(false);
      // KA3 Teil 1 — dreifach-negative Plausibilität: nichts angelegt, laute
      // Rückfrage statt stiller Abgabe.
      if (res.requiresConfirmation) {
        setForeignOpen(true);
        return;
      }
      setForeignOpen(false);
      if (res.noOpenTimeEntry) {
        toast.warning("Abrechnung gespeichert. Kein offener Zeiteintrag — nichts ausgestempelt.");
      } else if (res.idempotent) {
        toast.info("Abrechnung wurde bereits abgegeben (unverändert).");
      } else {
        toast.success("Abrechnung abgegeben & ausgestempelt.");
      }
      setForm(EMPTY_FORM);
      void qc.invalidateQueries({ queryKey: ["cash"] });
      void qc.invalidateQueries({ queryKey: ["time"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (myQ.isLoading || myQ.data == null) {
    return (
      <main className="mx-auto max-w-xl px-4 py-8">
        <div className="text-sm text-muted-foreground">Lade…</div>
      </main>
    );
  }

  const { session, settlement, businessDate, staffId: myStaffId, myPoolShareCents } = myQ.data;
  const servicePoolEnabled =
    (myQ.data as { servicePoolEnabled?: boolean }).servicePoolEnabled !== false;
  const kitchenTipRate = Number((myQ.data as { kitchenTipRate?: number }).kitchenTipRate ?? 0.02);
  const otherLocationSessionsCount =
    (myQ.data as { otherLocationSessionsCount?: number }).otherLocationSessionsCount ?? 0;
  const hasStaffLocations =
    (myQ.data as { hasStaffLocations?: boolean }).hasStaffLocations ?? false;
  const myExcludeStaffIds = [myStaffId];

  // Falls (für mich) keine Session offen: klarer Hinweis, ggf. mit Standort-Kontext.
  if (!session) {
    const wrongLocation = otherLocationSessionsCount > 0;
    const noStaffLocation = !hasStaffLocations;
    return (
      <main className="mx-auto max-w-xl space-y-6 px-4 py-8">
        <Header showKasseLink={canOpenSession} />
        <Card className="space-y-3 p-6 text-sm">
          <div className="flex items-center gap-2">
            <Badge variant="secondary">Keine Session</Badge>
            <span className="text-muted-foreground">Geschäftstag {businessDate}</span>
          </div>
          {wrongLocation ? (
            <p className="text-muted-foreground">
              An deinem zugeordneten Standort wurde für heute noch{" "}
              <strong>keine Kassen-Session</strong> eröffnet. Es sind aber{" "}
              {otherLocationSessionsCount} Session(s) an anderen Standorten offen — bitte deinen
              Manager, an deinem Standort zu eröffnen oder deine Standort-Zuordnung zu prüfen.
            </p>
          ) : noStaffLocation ? (
            <p className="text-muted-foreground">
              Dir ist noch <strong>kein Standort</strong> zugeordnet. Bitte wende dich an deinen
              Manager, damit deine Standort-Zuordnung eingerichtet wird.
            </p>
          ) : (
            <p className="text-muted-foreground">
              Für heute wurde noch <strong>keine Kassen-Session</strong> eröffnet. Bitte wende dich
              an deinen Manager oder Admin, damit die Session geöffnet wird.
            </p>
          )}
        </Card>
      </main>
    );
  }

  const sessionLocationName = (session as { locationName?: string | null }).locationName ?? null;

  // Bereits abgegeben → read-only Ansicht.
  if (settlement) {
    const locked = settlement.status === "locked" || session.status === "locked";
    const diff = Number(settlement.differenz_cents);
    const pos = Number(settlement.pos_sales_cents);
    const kassiertBrutto = Number(
      (settlement as { kassiert_brutto_cents?: number | string | null }).kassiert_brutto_cents ??
        settlement.pos_sales_cents,
    );
    // Brutto-Trinkgeld INKL. Küchenanteil = abgegebenes Bargeld − Soll-Abgabe (Differenz).
    const grossTipCents = Number(settlement.cash_handed_in_cents) - diff;
    // Quote auf die Leistung (POS); Küche 2 % ist eingerechnet, wird nicht separat ausgewiesen.
    const tipPct = pos > 0 ? (grossTipCents / pos) * 100 : null;
    const sessionLocked = session.status === "locked";
    return (
      <main className="mx-auto max-w-xl space-y-6 px-4 py-8">
        <Header showKasseLink={canOpenSession} />
        <Card className="space-y-4 p-6">
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">Geschäftstag {businessDate}</div>
            <Badge variant={locked ? "secondary" : "default"}>{settlement.status}</Badge>
          </div>
          <SessionOpenBanner locationName={sessionLocationName} status={session.status} />
          <ReadOnlyRow label="Leistung (POS)" cents={pos} />
          <ReadOnlyRow label="Abzugebender Betrag" cents={kassiertBrutto} />
          <ReadOnlyRow label="EC-/Kartensumme" cents={Number(settlement.card_total_cents)} />
          <ReadOnlyRow label="Hilfsmahlzeiten" cents={Number(settlement.hilf_mahl_cents)} />
          <ReadOnlyRow label="Offene Rechnungen" cents={Number(settlement.open_invoices_cents)} />
          {(() => {
            const entries =
              (settlement as { openInvoiceEntries?: Array<{ name: string; cents: number }> })
                .openInvoiceEntries ?? [];
            if (entries.length === 0) return null;
            return (
              <ul className="ml-2 space-y-0.5 text-xs text-muted-foreground">
                {entries.map((e, i) => (
                  <li key={i} className="flex justify-between">
                    <span>· {e.name}</span>
                    <span className="font-mono tabular-nums">{formatCents(e.cents)} €</span>
                  </li>
                ))}
              </ul>
            );
          })()}
          <ReadOnlyRow
            label="Abgegebenes Bargeld"
            cents={Number(settlement.cash_handed_in_cents)}
          />
          <hr className="border-border" />
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Meine Trinkgeld-Quote</span>
            <span className="font-mono tabular-nums">
              {tipPct === null ? "–" : `${tipPct.toFixed(1).replace(".", ",")} %`}
            </span>
          </div>
          <div className="mt-2 rounded-md border bg-muted/40 p-3">
            {servicePoolEnabled ? (
              <>
                <div className="text-xs text-muted-foreground">Mein Pool-Anteil</div>
                {sessionLocked && myPoolShareCents != null ? (
                  <div className="mt-1 text-2xl font-semibold tabular-nums">
                    {formatCents(myPoolShareCents)} €
                  </div>
                ) : (
                  <div className="mt-1 text-sm text-muted-foreground">
                    Dein Anteil steht nach Tagesabschluss fest.
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="text-xs text-muted-foreground">Trinkgeld an diesem Standort</div>
                <div className="mt-1 text-sm">
                  Eigenes Trinkgeld verbleibt bei dir · Küchen-Abgabe{" "}
                  {(kitchenTipRate * 100)
                    .toFixed(2)
                    .replace(/\.?0+$/, "")
                    .replace(".", ",")}{" "}
                  %
                </div>
              </>
            )}
          </div>
          {settlement.submitted_at && (
            <div className="pt-2 text-sm text-muted-foreground">
              Abgegeben um {formatTime(settlement.submitted_at)}
              {settlement.auto_clockout_time_entry_id
                ? " — automatisch ausgestempelt."
                : " — kein offener Zeiteintrag, nichts ausgestempelt."}
            </div>
          )}
          {(() => {
            const partnerNames =
              (settlement as { partnerStaffNames?: string[] }).partnerStaffNames ??
              (settlement.second_waiter_name ? [settlement.second_waiter_name] : []);
            if (partnerNames.length === 0) return null;
            return (
              <div className="space-y-1 pt-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    {partnerNames.length === 1 ? "Zweiter Kellner" : "Mitarbeitende Kellner"}
                  </span>
                  <span>{partnerNames.join(", ")}</span>
                </div>
              </div>
            );
          })()}
        </Card>
        <p className="text-center text-xs text-muted-foreground">
          Änderungen kann nur der Manager über die Korrektur-Funktion eintragen.
        </p>
      </main>
    );
  }

  // Eingabe-Formular.
  return (
    <main className="mx-auto max-w-xl space-y-6 px-4 py-8">
      <Header showKasseLink={canOpenSession} />
      <Card className="space-y-4 p-6">
        <div className="text-sm text-muted-foreground">Geschäftstag {businessDate}</div>
        <SessionOpenBanner locationName={sessionLocationName} status={session.status} />
        <EuroField
          id="pos"
          label="Leistung (POS)"
          value={form.posSales}
          onChange={(v) => setForm({ ...form, posSales: v })}
          error={parsed.posSalesCents === null && form.posSales !== ""}
        />
        <EuroField
          id="kassiertBrutto"
          label="Abzugebender Betrag"
          value={form.kassiertBrutto}
          onChange={(v) => setForm({ ...form, kassiertBrutto: v })}
          error={
            (parsed.kassiertBruttoCents === null && form.kassiertBrutto !== "") ||
            kassiertBruttoNegative
          }
          errorMessage={
            kassiertBruttoNegative ? "Der abzugebende Betrag darf nicht negativ sein." : undefined
          }
          hint="Leer lassen, wenn identisch mit Leistung (POS)."
          placeholder="wie Leistung (POS)"
        />
        <EuroField
          id="card"
          label="EC-/Kartensumme"
          value={form.cardTotal}
          onChange={(v) => setForm({ ...form, cardTotal: v })}
          error={parsed.cardTotalCents === null && form.cardTotal !== ""}
        />
        <EuroField
          id="hilf"
          label="Hilfsmahlzeiten"
          value={form.hilfMahl}
          onChange={(v) => setForm({ ...form, hilfMahl: v })}
          error={parsed.hilfMahlCents === null && form.hilfMahl !== ""}
        />
        <OpenInvoicesField
          rows={form.openInvoices}
          onChange={(next) => setForm({ ...form, openInvoices: next })}
          rowValidity={parsed.openInvoiceRows}
          sumCents={parsed.openInvoicesCents}
        />
        <EuroField
          id="cash"
          label="Abgegebenes Bargeld"
          value={form.cashHandedIn}
          onChange={(v) => setForm({ ...form, cashHandedIn: v })}
          error={parsed.cashHandedInCents === null && form.cashHandedIn !== ""}
        />
        <div className="space-y-2">
          <Label>Weitere Kellner (optional)</Label>
          {form.partnerStaffIds.map((pid, idx) => {
            const others = form.partnerStaffIds.filter((_, i) => i !== idx).filter(Boolean);
            return (
              <div key={idx} className="flex items-center gap-2">
                <div className="flex-1">
                  <SecondWaiterSelect
                    value={pid || null}
                    onValueChange={(v) => {
                      const next = [...form.partnerStaffIds];
                      next[idx] = v ?? "";
                      setForm({ ...form, partnerStaffIds: next });
                    }}
                    excludeStaffIds={[...myExcludeStaffIds, ...others]}
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const next = form.partnerStaffIds.filter((_, i) => i !== idx);
                    setForm({ ...form, partnerStaffIds: next });
                  }}
                >
                  Entfernen
                </Button>
              </div>
            );
          })}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setForm({ ...form, partnerStaffIds: [...form.partnerStaffIds, ""] })}
          >
            + weiterer Kellner
          </Button>
        </div>
        <hr className="border-border" />
        <div className="space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Meine Trinkgeld-Quote (Vorschau)</span>
            <span className="font-mono tabular-nums">
              {previewTipPct === null ? "—" : `${previewTipPct.toFixed(1).replace(".", ",")} %`}
            </span>
          </div>
          <p className="pt-2 text-xs text-muted-foreground">
            Vorschau — verbindlich ist erst der Server-Snapshot beim Absenden.
          </p>
        </div>
        <Button
          size="lg"
          className="w-full"
          disabled={!allValid || submitMut.isPending}
          onClick={() => setConfirmOpen(true)}
        >
          Abrechnung absenden & ausstempeln
        </Button>
      </Card>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Abrechnung absenden?</DialogTitle>
            <DialogDescription>
              Die ArbZG-Pause wird automatisch auf den offenen Zeiteintrag angewendet. Die
              Abrechnung ist anschließend nicht mehr durch dich änderbar — Korrekturen laufen über
              den Manager.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Abbrechen
            </Button>
            <Button disabled={submitMut.isPending} onClick={() => submitMut.mutate({})}>
              {submitMut.isPending ? "Wird gesendet…" : "Absenden"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={foreignOpen} onOpenChange={setForeignOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rechnest du unter deinem Namen ab?</DialogTitle>
            <DialogDescription>
              Du bist heute nicht eingeplant, nicht eingestempelt und nicht im Trinkgeld-Pool.
              Rechnest du wirklich unter <strong>deinem</strong> Namen ab?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setForeignOpen(false)}>
              Abbrechen
            </Button>
            <Button
              variant="destructive"
              disabled={submitMut.isPending}
              onClick={() => submitMut.mutate({ confirmedForeign: true })}
            >
              {submitMut.isPending ? "Wird gesendet…" : "Trotzdem abrechnen"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

function Header({ showKasseLink = false }: { showKasseLink?: boolean }) {
  return (
    <header className="flex items-center justify-between">
      <h1 className="text-2xl font-semibold tracking-tight">Abrechnung</h1>
      <div className="flex items-center gap-3 text-sm">
        {showKasseLink && (
          <Link
            to="/admin/kasse"
            search={{ locationId: undefined, businessDate: undefined }}
            className="text-muted-foreground hover:text-foreground"
          >
            Tagesabrechnung
          </Link>
        )}
        <Link to="/zeit" className="text-muted-foreground hover:text-foreground">
          Mein COCO
        </Link>
      </div>
    </header>
  );
}

function SessionOpenBanner({
  locationName,
  status,
}: {
  locationName: string | null;
  status: string;
}) {
  const locked = status === "locked";
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm">
      <Badge variant={locked ? "secondary" : "default"}>
        {locked ? "Session gesperrt" : "Session eröffnet"}
      </Badge>
      <span className="text-muted-foreground">Standort:</span>
      <span className="font-medium">{locationName ?? "unbekannt"}</span>
    </div>
  );
}

function EuroField({
  id,
  label,
  value,
  onChange,
  error,
  hint,
  placeholder,
  errorMessage,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  error: boolean;
  hint?: string;
  placeholder?: string;
  errorMessage?: string;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label} (€)</Label>
      <Input
        id={id}
        inputMode="decimal"
        placeholder={placeholder ?? "0,00"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error}
      />
      {error && (
        <p className="text-xs text-destructive">
          {errorMessage ?? "Bitte einen Eurobetrag eingeben."}
        </p>
      )}
      {!error && hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function ReadOnlyRow({
  label,
  cents,
  highlight,
}: {
  label: string;
  cents: number;
  highlight?: boolean;
}) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={`font-mono tabular-nums ${highlight && cents < 0 ? "text-destructive" : ""}`}
      >
        {formatCents(cents)} €
      </span>
    </div>
  );
}

// Liste einzelner offener Rechnungen (Reservierungsname + Euro). Jede Zeile
// mit Betrag > 0 braucht einen Namen — sonst kann die Abrechnung nicht
// abgegeben werden (Server erzwingt dieselbe Regel).
function OpenInvoicesField({
  rows,
  onChange,
  rowValidity,
  sumCents,
}: {
  rows: Array<{ name: string; amount: string }>;
  onChange: (next: Array<{ name: string; amount: string }>) => void;
  rowValidity: Array<{ name: string; cents: number | null; valid: boolean }>;
  sumCents: number;
}) {
  const update = (idx: number, patch: Partial<{ name: string; amount: string }>) => {
    const next = rows.map((r, i) => (i === idx ? { ...r, ...patch } : r));
    onChange(next);
  };
  const remove = (idx: number) => onChange(rows.filter((_, i) => i !== idx));
  const add = () => onChange([...rows, { name: "", amount: "" }]);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>Offene Rechnungen</Label>
        <span className="text-xs text-muted-foreground">
          Summe: <span className="font-mono tabular-nums">{formatCents(sumCents)} €</span>
        </span>
      </div>
      {rows.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Keine offene Rechnung. Falls doch, unten „+ offene Rechnung" — Reservierungsname ist
          Pflicht.
        </p>
      )}
      {rows.map((r, idx) => {
        const v = rowValidity[idx];
        const nameMissing = v ? !v.valid && (v.cents ?? 0) > 0 && v.name.length === 0 : false;
        const amountInvalid = v ? v.cents === null : false;
        return (
          <div key={idx} className="space-y-1 rounded-md border border-border/70 p-2">
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="flex-1 space-y-1">
                <Input
                  placeholder="Reservierungs-/Gästename"
                  value={r.name}
                  onChange={(e) => update(idx, { name: e.target.value })}
                  aria-invalid={nameMissing}
                />
              </div>
              <div className="w-full space-y-1 sm:w-40">
                <Input
                  inputMode="decimal"
                  placeholder="0,00 €"
                  value={r.amount}
                  onChange={(e) => update(idx, { amount: e.target.value })}
                  aria-invalid={amountInvalid}
                />
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => remove(idx)}>
                Entfernen
              </Button>
            </div>
            {nameMissing && (
              <p className="text-xs text-destructive">
                Bitte Reservierungsname eintragen — sonst kann die Abrechnung nicht abgegeben
                werden.
              </p>
            )}
            {amountInvalid && (
              <p className="text-xs text-destructive">Bitte gültigen Eurobetrag eintragen.</p>
            )}
          </div>
        );
      })}
      <Button type="button" variant="outline" size="sm" onClick={add}>
        + offene Rechnung
      </Button>
    </div>
  );
}
