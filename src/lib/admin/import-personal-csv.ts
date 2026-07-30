// Pure CSV-Parser für Personaldaten Welle 1.
// Pflichtspalten (Semikolon, BOM-toleriert):
//   alt_staff_id;first_name;last_name  — optional: nickname;perso_nr;employment_start
//
// `first_name` wird 1:1 übernommen (inkl. Klammer-Spitznamen wie
// "Phattanaphol (ANDI)"). `nickname`, `perso_nr` und `employment_start`
// dürfen leer sein.
// `hourly_rate` wird seit ST1-C1 ignoriert — Bereichs-Sätze werden im
// Stammblatt gepflegt (LG3b). Alte CSVs mit der Spalte bleiben einlesbar.

import type { PersonalRowInput } from "./import-personal";

export type PersonalParseWarning =
  | { kind: "missing_field"; row: number; field: string }
  | { kind: "invalid_number"; row: number; field: string; raw: string }
  | { kind: "invalid_date"; row: number; raw: string };

export type PersonalParseResult = {
  rows: PersonalRowInput[];
  warnings: PersonalParseWarning[];
};

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}
function splitLines(csv: string): string[] {
  return stripBom(csv)
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+$/, ""))
    .filter((l) => l.length > 0);
}
function splitRow(line: string): string[] {
  return line.split(";").map((c) => c.trim());
}
function parseHeader(line: string): Map<string, number> {
  const cols = splitRow(line).map((c) => c.toLowerCase());
  const map = new Map<string, number>();
  cols.forEach((c, i) => map.set(c, i));
  return map;
}

function parsePersoNr(raw: string): number | null {
  if (raw.length === 0) return null;
  const v = Number(raw);
  return Number.isInteger(v) ? v : null;
}

function normalizeDate(raw: string): string | null {
  if (raw.length === 0) return null;
  // Akzeptiert YYYY-MM-DD direkt; alles andere = ungültig.
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  // Optional: DD.MM.YYYY → YYYY-MM-DD
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(raw);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

export function parsePersonalCsv(csv: string): PersonalParseResult {
  const lines = splitLines(csv);
  const warnings: PersonalParseWarning[] = [];
  const rows: PersonalRowInput[] = [];
  if (lines.length === 0) return { rows, warnings };

  const header = parseHeader(lines[0]);
  const iAlt = header.get("alt_staff_id");
  const iFirst = header.get("first_name");
  const iLast = header.get("last_name");
  const iNick = header.get("nickname");
  const iPerso = header.get("perso_nr");
  const iStart = header.get("employment_start");
  if (iAlt == null || iFirst == null || iLast == null) {
    throw new Error(
      "Personal-CSV: Spalten alt_staff_id;first_name;last_name (optional: nickname;perso_nr;employment_start) erwartet.",
    );
  }

  for (let r = 1; r < lines.length; r++) {
    const cols = splitRow(lines[r]);
    const altStaffId = cols[iAlt] ?? "";
    const firstName = cols[iFirst] ?? "";
    const lastName = cols[iLast] ?? "";
    const nickname = (iNick != null ? cols[iNick] : "") ?? "";
    const persoRaw = (iPerso != null ? cols[iPerso] : "") ?? "";
    const startRaw = (iStart != null ? cols[iStart] : "") ?? "";

    if (!altStaffId) {
      warnings.push({ kind: "missing_field", row: r, field: "alt_staff_id" });
      continue;
    }
    if (!firstName) {
      warnings.push({ kind: "missing_field", row: r, field: "first_name" });
      continue;
    }
    if (!lastName) {
      warnings.push({ kind: "missing_field", row: r, field: "last_name" });
      continue;
    }
    const persoNr = persoRaw.length > 0 ? parsePersoNr(persoRaw) : null;
    if (persoRaw.length > 0 && persoNr === null) {
      warnings.push({ kind: "invalid_number", row: r, field: "perso_nr", raw: persoRaw });
      // perso_nr-Fehler ist nicht fatal — Zeile trotzdem importieren, ohne persoNr.
    }
    let employmentStart: string | null = null;
    if (startRaw.length > 0) {
      employmentStart = normalizeDate(startRaw);
      if (employmentStart === null) {
        warnings.push({ kind: "invalid_date", row: r, raw: startRaw });
        // Datumsfehler ist nicht fatal — Fallback greift später.
      }
    }

    rows.push({
      altStaffId,
      firstName,
      lastName,
      nickname,
      persoNr,
      employmentStart,
    });
  }

  return { rows, warnings };
}
