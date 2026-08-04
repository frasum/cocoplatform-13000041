// Reines Modul: baut den Telegram-HTML-Text des Tagesberichts.
// Keine Server-/Netz-/DB-Aufrufe — alle Beträge kommen als Cents rein,
// alle Timestamps als ISO-Strings. Zeitangaben werden in Europe/Berlin
// formatiert. escapeHtml() wird auf ALLE dynamischen Strings angewandt,
// weil Telegram im HTML-Modus sonst bei `<b>` in einer Notiz bricht.

import { fmtEuroPerHour } from "./revenue-per-hour";

export type ReportFlags = {
  umsatz: boolean;
  gaeste: boolean;
  kontrolle: boolean;
  kellner: boolean;
  kueche: boolean;
  notizen: boolean;
  excludedLocationIds: string[];
};

export const DEFAULT_REPORT_FLAGS: ReportFlags = {
  umsatz: true,
  gaeste: true,
  kontrolle: true,
  kellner: true,
  kueche: true,
  notizen: true,
  excludedLocationIds: [],
};

export type ReportWaiter = {
  name: string;
  posSalesCents: number;
  submittedAt: string | null;
};

export type ReportKitchen = {
  name: string;
  shiftStart: string | null;
  shiftEnd: string | null;
  minutes?: number | null;
};

export type ReportKontrolle = {
  fehlbetragVortagCents: number; // ≤ 0
  ausgabenCents: number;
  tagesBargeldCents: number;
  differenzWechselgeldCents: number; // = tagesBargeld + min(0, fehlbetragVortag)
  wechselgeldbestandCents: number;
};

export type ReportLocationInput = {
  locationId: string;
  name: string;
  hasSession: boolean;
  vectronCents?: number;
  guestCount?: number;
  /** TG5 — Umsatz je Arbeitsstunde in Cents; null = keine Stunden erfasst. */
  revenuePerWorkHourCents?: number | null;
  kontrolle?: ReportKontrolle;
  waiters?: ReportWaiter[];
  kitchen?: ReportKitchen[];
  notes?: string | null;
};

export type ReportInput = {
  businessDate: string; // ISO YYYY-MM-DD (Berlin)
  locations: ReportLocationInput[];
};

// ---------------------------------------------------------------
// Helper (pur, unit-testbar)
// ---------------------------------------------------------------

export function escapeHtml(input: string): string {
  return input.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

const EUR_FMT = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function fmtCents(cents: number): string {
  // Intl fügt in de-DE ein NBSP (U+00A0) zwischen Zahl und € ein.
  // Für Telegram-Text auf normale Leerzeichen normalisieren.
  return EUR_FMT.format((cents ?? 0) / 100).replace(/\u00A0/g, " ");
}

const TIME_FMT = new Intl.DateTimeFormat("de-DE", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Europe/Berlin",
});

export function fmtBerlinTime(iso: string | null | undefined): string {
  if (!iso) return "--:--";
  // Reine Uhrzeit ("HH:MM" oder "HH:MM:SS", Berlin-Wandzeit aus der Pool-Karte):
  // direkt HH:MM zurückgeben, kein Date-Parsing.
  const hm = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(iso.trim());
  if (hm) return `${hm[1]}:${hm[2]}`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--:--";
  // "HH:MM" statt "HH.MM" (Intl liefert auf einigen Runtimes de-DE mit Punkt).
  const parts = TIME_FMT.formatToParts(d);
  const h = parts.find((p) => p.type === "hour")?.value ?? "00";
  const m = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${h}:${m}`;
}

const DATE_FMT = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "Europe/Berlin",
});

export function fmtBerlinDate(iso: string): string {
  // iso ist YYYY-MM-DD — als lokaler Mittag interpretieren, damit
  // Zeitzonen-Verschiebung das Datum nicht kippt.
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return DATE_FMT.format(d);
}

// ---------------------------------------------------------------
// Report-Aufbau
// ---------------------------------------------------------------

export function buildDailyReport(input: ReportInput, flags: ReportFlags): string {
  const excluded = new Set(flags.excludedLocationIds);
  const locs = input.locations.filter((l) => !excluded.has(l.locationId));

  const header = `<b>Tagesbericht ${escapeHtml(fmtBerlinDate(input.businessDate))}</b>`;
  const blocks = locs.map((l) => renderLocation(l, flags));
  return [header, ...blocks].join("\n\n");
}

function renderLocation(loc: ReportLocationInput, flags: ReportFlags): string {
  const title = `<b>${escapeHtml(loc.name)}</b>`;
  if (!loc.hasSession) {
    return `${title}\nKeine Daten`;
  }

  const lines: string[] = [title];

  if (flags.umsatz && loc.vectronCents !== undefined) {
    // TG5 — Umsatz je Arbeitsstunde direkt an der Umsatzzeile; Wert kommt
    // fertig aus der Statistik-Kennzahl (keine Rechnung hier).
    const perHour =
      loc.revenuePerWorkHourCents === undefined
        ? ""
        : ` · ${escapeHtml(fmtEuroPerHour(loc.revenuePerWorkHourCents))}`;
    lines.push(`Vectron: ${escapeHtml(fmtCents(loc.vectronCents))}${perHour}`);
  }
  if (flags.gaeste && (loc.guestCount ?? 0) > 0) {
    const avg = (loc.vectronCents ?? 0) / (loc.guestCount ?? 1);
    lines.push(`Gäste: ${loc.guestCount} (⌀ ${escapeHtml(fmtCents(Math.round(avg)))})`);
  }

  if (flags.kontrolle && loc.kontrolle) {
    const k = loc.kontrolle;
    lines.push("");
    lines.push("<b>Kontrolle</b>");
    lines.push(`• Fehlbetrag Vortag: ${escapeHtml(fmtCents(k.fehlbetragVortagCents))}`);
    lines.push(`• Ausgaben: ${escapeHtml(fmtCents(k.ausgabenCents))}`);
    lines.push(`• Tages-Bargeld: ${escapeHtml(fmtCents(k.tagesBargeldCents))}`);
    lines.push(
      `• Differenz zum Wechselgeldbestand: ${escapeHtml(fmtCents(k.differenzWechselgeldCents))}`,
    );
    lines.push(`• Wechselgeldbestand: ${escapeHtml(fmtCents(k.wechselgeldbestandCents))}`);
  }

  if (flags.kellner && loc.waiters && loc.waiters.length > 0) {
    lines.push("");
    lines.push("<b>Kellner</b>");
    for (const w of loc.waiters) {
      const time = w.submittedAt ? ` (Abgabe ${fmtBerlinTime(w.submittedAt)})` : "";
      lines.push(`• ${escapeHtml(w.name)}: ${escapeHtml(fmtCents(w.posSalesCents))}${time}`);
    }
  }

  if (flags.kueche && loc.kitchen && loc.kitchen.length > 0) {
    lines.push("");
    lines.push("<b>Küche</b>");
    for (const k of loc.kitchen) {
      const parts: string[] = [];
      if (k.shiftStart || k.shiftEnd) {
        parts.push(`${fmtBerlinTime(k.shiftStart)}–${fmtBerlinTime(k.shiftEnd)}`);
      }
      if (typeof k.minutes === "number" && k.minutes > 0) {
        const h = Math.floor(k.minutes / 60);
        const m = k.minutes % 60;
        parts.push(m === 0 ? `${h}h` : `${h}h ${m}min`);
      }
      const suffix = parts.length > 0 ? ` (${parts.join(", ")})` : "";
      lines.push(`• ${escapeHtml(k.name)}${suffix}`);
    }
  }

  if (flags.notizen && loc.notes && loc.notes.trim().length > 0) {
    lines.push("");
    lines.push(`📝 ${escapeHtml(loc.notes.trim())}`);
  }

  return lines.join("\n");
}
