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

// Toleriert atypische Formatierungen:
//   export const f = createServerFn(...)
//   export   const  f   =   createServerFn
//   export const f: SomeType = createServerFn
//   const f = createServerFn  (nicht exportiert, aber lokal weiterverwendet)
//   Zeilenumbrüche zwischen Name, "=" und createServerFn
const DECL_RE = /(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=;]+)?=\s*createServerFn\b/g;
// createServerFn-Vorkommen, die KEINE Deklaration sind (Import, Kommentar-Erwähnung):
const CREATE_RE = /\bcreateServerFn\b/g;
const POST_RE = /method\s*:\s*["'`]POST["'`]/;
const ASSERT_RE = /assertRealIdentity\s*\(/;

function splitBlocks(source: string): Block[] {
  const starts: { name: string; index: number }[] = [];
  let m: RegExpExecArray | null;
  DECL_RE.lastIndex = 0;
  while ((m = DECL_RE.exec(source)) !== null) {
    starts.push({ name: m[1], index: m.index });
  }
  return starts.map((s, i) => ({
    name: s.name,
    body: source.slice(s.index, i + 1 < starts.length ? starts[i + 1].index : source.length),
  }));
}

const BLOCKS = splitBlocks(SOURCE);

function callRe(fn: string): RegExp {
  return new RegExp(`\\b${fn}\\s*\\(`);
}

function unguarded(loader: string): string[] {
  const loaderRe = callRe(loader);
  return BLOCKS.filter(
    (b) => POST_RE.test(b.body) && loaderRe.test(b.body) && !ASSERT_RE.test(b.body),
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
