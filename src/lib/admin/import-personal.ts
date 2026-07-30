// Reines Mapping-/Diff-Modul für `importStaffPersonalData` (Welle 1).
// Keine I/O — alle Daten kommen als Parameter rein, das Ergebnis ist ein
// Plan-Objekt mit Diff je MA, Skip-Liste und Bilanz. Damit ist die komplette
// Geschäftslogik (Namens-Diff, display_name-Schutz, perso_nr-Schutz)
// ohne DB testbar. Lohnsätze sind seit ST1-C1 nicht mehr Teil des Imports.

export type PersonalRowInput = {
  altStaffId: string;
  firstName: string;
  lastName: string;
  /** Spitzname aus dem Alt-System (Quelle für `display_name`). */
  nickname: string;
  /** Personalnummer; `null` = im CSV leer → NICHT überschreiben. */
  persoNr: number | null;
  /** YYYY-MM-DD; `null` = leer → Fallback auf `fallbackValidFrom`. */
  employmentStart: string | null;
};

export type CurrentStaffRow = {
  staffId: string;
  firstName: string;
  lastName: string;
  displayName: string;
  persoNr: number | null;
};

export type PersonalSkipReason = "unknown_alt_staff";
export type SkippedPersonalRow = {
  reason: PersonalSkipReason;
  altStaffId: string;
  firstName?: string;
  lastName?: string;
};

export type StaffFieldChange<T> = { from: T; to: T };
export type StaffUpdateFields = {
  first_name?: string;
  last_name?: string;
  display_name?: string;
  perso_nr?: number;
};

export type PersonalStaffDiff = {
  staffId: string;
  altStaffId: string;
  nameDiff: {
    first_name?: StaffFieldChange<string>;
    last_name?: StaffFieldChange<string>;
    display_name?: StaffFieldChange<string>;
    perso_nr?: StaffFieldChange<number | null>;
  };
};

export type StaffUpdateOp = {
  staffId: string;
  fields: StaffUpdateFields;
};

export type ComputePersonalPlanInput = {
  rows: PersonalRowInput[];
  /** altStaffId → staff_id (org-scoped, aus staff_identity_map mit confirmed_at). */
  staffMap: Map<string, string>;
  /** staffId → bestehende staff-Felder (für Diff + display_name-Schutz). */
  currentStaff: Map<string, CurrentStaffRow>;
};

export type PersonalPlan = {
  perStaff: PersonalStaffDiff[];
  staffUpdates: StaffUpdateOp[];
  skippedRows: SkippedPersonalRow[];
  totals: {
    rows: number;
    staff: number;
    nameUpdates: number;
    skippedCount: number;
  };
};

export function computePersonalPlan(input: ComputePersonalPlanInput): PersonalPlan {
  const skipped: SkippedPersonalRow[] = [];
  const perStaff: PersonalStaffDiff[] = [];
  const staffUpdates: StaffUpdateOp[] = [];
  const touched = new Set<string>();

  for (const row of input.rows) {
    const staffId = input.staffMap.get(row.altStaffId);
    if (!staffId) {
      skipped.push({
        reason: "unknown_alt_staff",
        altStaffId: row.altStaffId,
        firstName: row.firstName,
        lastName: row.lastName,
      });
      continue;
    }
    if (touched.has(staffId)) {
      // Duplikat im CSV — defensiv überspringen (erster Treffer gewinnt).
      continue;
    }
    touched.add(staffId);

    const current = input.currentStaff.get(staffId);
    const nameDiff: PersonalStaffDiff["nameDiff"] = {};
    const fields: StaffUpdateFields = {};

    if (current) {
      if (current.firstName !== row.firstName) {
        nameDiff.first_name = { from: current.firstName, to: row.firstName };
        fields.first_name = row.firstName;
      }
      if (current.lastName !== row.lastName) {
        nameDiff.last_name = { from: current.lastName, to: row.lastName };
        fields.last_name = row.lastName;
      }
      // display_name = nickname, ABER nur wenn nickname nicht leer
      // (display_name ist NOT NULL — leeren String nicht reinschreiben).
      if (row.nickname.length > 0 && current.displayName !== row.nickname) {
        nameDiff.display_name = { from: current.displayName, to: row.nickname };
        fields.display_name = row.nickname;
      }
      // perso_nr leer im CSV → NICHT anfassen (defensiv, kein Datenverlust).
      if (row.persoNr !== null && current.persoNr !== row.persoNr) {
        nameDiff.perso_nr = { from: current.persoNr, to: row.persoNr };
        fields.perso_nr = row.persoNr;
      }
    } else {
      // Sollte praktisch nie passieren (identity_map verweist auf staff),
      // aber defensiv: behandle als „alle Felder neu".
      nameDiff.first_name = { from: "", to: row.firstName };
      nameDiff.last_name = { from: "", to: row.lastName };
      fields.first_name = row.firstName;
      fields.last_name = row.lastName;
      if (row.nickname.length > 0) {
        nameDiff.display_name = { from: "", to: row.nickname };
        fields.display_name = row.nickname;
      }
      if (row.persoNr !== null) {
        nameDiff.perso_nr = { from: null, to: row.persoNr };
        fields.perso_nr = row.persoNr;
      }
    }

    if (Object.keys(fields).length > 0) {
      staffUpdates.push({ staffId, fields });
    }

    perStaff.push({
      staffId,
      altStaffId: row.altStaffId,
      nameDiff,
    });
  }

  const nameUpdates = staffUpdates.length;

  return {
    perStaff,
    staffUpdates,
    skippedRows: skipped,
    totals: {
      rows: input.rows.length,
      staff: touched.size,
      nameUpdates,
      skippedCount: skipped.length,
    },
  };
}

/** SHA-256 der normalisierten Eingabe für Audit-Reproduzierbarkeit. */
export async function hashPersonalInput(rows: PersonalRowInput[]): Promise<string> {
  const norm = [...rows]
    .map((r) => ({
      altStaffId: r.altStaffId,
      firstName: r.firstName,
      lastName: r.lastName,
      nickname: r.nickname,
      persoNr: r.persoNr,
      employmentStart: r.employmentStart,
    }))
    .sort((a, b) => a.altStaffId.localeCompare(b.altStaffId));
  const buf = new TextEncoder().encode(JSON.stringify(norm));
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
