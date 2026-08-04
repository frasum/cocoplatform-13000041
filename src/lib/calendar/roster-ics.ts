// Reine iCalendar-Erzeugung (RFC 5545) für Dienstplan-Abos.
//
// Diese Datei enthält KEIN I/O — nur Formatierung. Der Aufrufer (die
// öffentliche Feed-Route) übergibt bereits aufgelöste Events. Text
// wird nach RFC-5545-Regeln escaped, Zeitpunkte werden in "UTC-Basic"
// (`YYYYMMDDTHHMMSSZ`) geschrieben, Ganztagseinträge nutzen
// `DTSTART;VALUE=DATE`. Line-Endings sind `\r\n`.

export type RosterIcsEvent =
  | {
      uid: string;
      summary: string;
      location: string;
      /** Optional: maschinenlesbare Tags (CATEGORIES), z. B. URLAUB_UNBEZAHLT. */
      categories?: string[];
      allDay: true;
      date: string; // YYYY-MM-DD
      // Optional: exklusives Ende für mehrtägige Ganztags-Events.
      // Erwartet YYYY-MM-DD des Tages NACH dem letzten Tag (RFC 5545).
      endDateExclusive?: string;
    }
  | {
      uid: string;
      summary: string;
      location: string;
      categories?: string[];
      allDay: false;
      startIso: string; // ISO-8601 UTC
      endIso: string;
    };

export type BuildRosterIcsInput = {
  calendarName: string;
  events: RosterIcsEvent[];
  now?: Date; // Testbarkeit für DTSTAMP
};

// Escape für TEXT-Werte (SUMMARY, LOCATION, DESCRIPTION).
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

// "YYYYMMDDTHHMMSSZ" aus ISO-8601 (UTC).
export function utcBasicFromIso(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

function dateBasic(isoDate: string): string {
  return isoDate.replace(/-/g, "");
}

/**
 * N17 (13.07.): RFC-5545-Zeilenfaltung. Lange Content-Zeilen (> 75 Oktette
 * in UTF-8) werden mit CRLF + führendem Leerzeichen umgebrochen; der Cut
 * darf nie mitten in einem Mehrbyte-Zeichen liegen (sonst mojibake in
 * strengen Clients wie Outlook).
 */
export function foldIcsLine(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const decoder = new TextDecoder("utf-8");
  const chunks: string[] = [];
  let start = 0;
  while (start < bytes.length) {
    const isFirst = chunks.length === 0;
    // Fortsetzungszeile beginnt mit einem WS-Oktett → dessen Budget ist 74.
    const budget = isFirst ? 75 : 74;
    let end = Math.min(start + budget, bytes.length);
    // Nicht mitten in einem UTF-8-Continuation-Byte (10xxxxxx) trennen.
    if (end < bytes.length) {
      while (end > start && (bytes[end] & 0xc0) === 0x80) end--;
    }
    const slice = bytes.slice(start, end);
    chunks.push((isFirst ? "" : " ") + decoder.decode(slice));
    start = end;
  }
  return chunks.join("\r\n");
}

export function buildRosterIcs(input: BuildRosterIcsInput): string {
  const now = input.now ?? new Date();
  const dtstamp = utcBasicFromIso(now.toISOString());
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//COCO//Dienstplan//DE",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(input.calendarName)}`,
  ];
  for (const ev of input.events) {
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${ev.uid}`);
    lines.push(`DTSTAMP:${dtstamp}`);
    if (ev.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${dateBasic(ev.date)}`);
      if (ev.endDateExclusive) {
        lines.push(`DTEND;VALUE=DATE:${dateBasic(ev.endDateExclusive)}`);
      }
    } else {
      lines.push(`DTSTART:${utcBasicFromIso(ev.startIso)}`);
      lines.push(`DTEND:${utcBasicFromIso(ev.endIso)}`);
    }
    lines.push(`SUMMARY:${escapeIcsText(ev.summary)}`);
    lines.push(`LOCATION:${escapeIcsText(ev.location)}`);
    if (ev.categories && ev.categories.length > 0) {
      lines.push(`CATEGORIES:${ev.categories.map(escapeIcsText).join(",")}`);
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldIcsLine).join("\r\n") + "\r\n";
}
