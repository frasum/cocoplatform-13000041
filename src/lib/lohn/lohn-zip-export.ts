// EX1 — Sammelexport: je Person ein Excel (unverändert `buildLohnXlsx`),
// gebündelt als ZIP. Reine Funktionen, keine UI-Abhängigkeit, damit die
// Bündelung testbar bleibt. Format der Einzeldateien ist bit-identisch zum
// Einzel-Export — hier wird ausschließlich verpackt und benannt.

import { buildLohnFileName } from "./lohn-excel-export";

export interface LohnZipPerson {
  staffLabel: string;
  fromDate: string;
  toDate: string;
  /** false → keine Entgeltzeilen (0 h und keine U/K-Tage) → keine Datei. */
  hasEntgeltzeilen: boolean;
  /** Ergebnis von `buildLohnXlsx`. */
  blob: Blob;
}

/**
 * Personenauswahl fürs Sammel-ZIP: mindestens eine Entgeltzeile zu erwarten
 * (Stunden > 0 ODER U-/K-Tage > 0). Personen ohne alles werden ausgelassen,
 * damit keine leeren Dateien im ZIP landen.
 */
export function hasEntgeltzeilen(row: {
  totalHours?: number | null;
  urlaubTage?: number | null;
  krankTage?: number | null;
}): boolean {
  return (
    Number(row.totalHours ?? 0) > 0 ||
    Number(row.urlaubTage ?? 0) > 0 ||
    Number(row.krankTage ?? 0) > 0
  );
}

/**
 * Kollisionsfreie Dateinamen: zwei Labels können auf denselben Safe-Namen
 * normalisieren (`buildLohnFileName`). Dann bekommt jede weitere Datei ein
 * deterministisches `_2`, `_3` … vor der Endung — nie stilles Überschreiben.
 */
export function uniqueFileName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) {
    taken.add(name);
    return name;
  }
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let n = 2;
  let candidate = `${base}_${n}${ext}`;
  while (taken.has(candidate)) {
    n += 1;
    candidate = `${base}_${n}${ext}`;
  }
  taken.add(candidate);
  return candidate;
}

export async function buildLohnZip(persons: readonly LohnZipPerson[]): Promise<Blob> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  const taken = new Set<string>();
  for (const p of persons) {
    if (!p.hasEntgeltzeilen) continue;
    const name = uniqueFileName(buildLohnFileName(p.staffLabel, p.fromDate, p.toDate), taken);
    zip.file(name, await p.blob.arrayBuffer());
  }
  return await zip.generateAsync({ type: "blob" });
}

export function buildLohnZipFileName(fromDate: string, toDate: string): string {
  return `lohn_alle_${fromDate}_${toDate}.zip`;
}
