// IM1 — Wächter: Vorschau-Schutz in allen Kassen-Schreibpfaden.
//
// Bedrohungsmodell: In der Admin-Vorschau (AV1) wird die Rolle des Vorschau-Ziels
// geladen — bei einer Vorschau auf einen Manager/Admin stehen damit alle
// Schreibgates offen, obwohl die Vorschau laut Kopfkommentar in
// src/lib/admin/impersonation.ts strikt lesend ist. Deshalb muss jede mutierende
// Server-Function unmittelbar nach dem Caller-Load `assertRealIdentity(caller)`
// rufen. Dieser Test prüft das statisch am Quelltext (Vorbild:
// src/lib/server-boundary.test.ts) und schützt auch künftige Functions.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const SOURCE = readFileSync("src/lib/cash/cash.functions.ts", "utf8");

type Block = { name: string; body: string };

function splitBlocks(source: string): Block[] {
  const re = /export const (\w+) = createServerFn/g;
  const starts: { name: string; index: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    starts.push({ name: m[1], index: m.index });
  }
  return starts.map((s, i) => ({
    name: s.name,
    body: source.slice(s.index, i + 1 < starts.length ? starts[i + 1].index : source.length),
  }));
}

const BLOCKS = splitBlocks(SOURCE);

function unguarded(loader: string): string[] {
  return BLOCKS.filter(
    (b) =>
      b.body.includes('method: "POST"') &&
      b.body.includes(`${loader}(`) &&
      !b.body.includes("assertRealIdentity("),
  ).map((b) => b.name);
}

describe("Kassen-Schreibpfade sind vorschau-geschützt", () => {
  it("jeder POST-Pfad mit loadAdminCaller ruft assertRealIdentity", () => {
    const offenders = unguarded("loadAdminCaller");
    expect(offenders, `Ohne assertRealIdentity: ${offenders.join(", ")}`).toEqual([]);
  });

  it("jeder POST-Pfad mit loadStaffCaller ruft assertRealIdentity", () => {
    const offenders = unguarded("loadStaffCaller");
    expect(offenders, `Ohne assertRealIdentity: ${offenders.join(", ")}`).toEqual([]);
  });

  it("das Zerlege-Regex findet genügend POST-Admin-Blöcke (Schärfe-Gegenprobe)", () => {
    const adminPosts = BLOCKS.filter(
      (b) => b.body.includes('method: "POST"') && b.body.includes("loadAdminCaller("),
    );
    expect(adminPosts.length).toBeGreaterThanOrEqual(10);
  });
});
