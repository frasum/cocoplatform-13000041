// RN1-T (§107) — Negativ-DB-Tests für `payroll_recurring_notes`.
//
// Die RN1-Härtung (REVOKE aller Client-Schreibrechte + DROP der
// Client-Policies) ist live, aber bislang unbewacht. Diese Suite prüft,
// dass ein regulär angemeldeter Manager weder direkt INSERTs noch
// UPDATEs gegen die Tabelle absetzen kann — der einzige Weg bleibt der
// Server-Fn-Pfad (der hier bewusst NICHT positiv gegengeprüft wird,
// weil das Auth-Middleware-Setup außerhalb des DB-Test-Musters liegt;
// siehe Chat-Meldung zum Commit).
//
// Läuft nur unter `SUPABASE_DB_TESTS=1` (siehe src/test/db-setup.ts).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { dbTestsEnabled, seedOrg, signInAsUser, type SeededOrg } from "@/test/db-setup";

describe.skipIf(!dbTestsEnabled)("payroll_recurring_notes RLS (RN1-T)", () => {
  let org: SeededOrg;
  let managerEmail: string;
  let managerPassword: string;
  let managerStaffId: string;
  let seededId: string;
  const seededText = "seed-original-text";

  beforeAll(async () => {
    org = await seedOrg("payroll-recurring-notes-rls");
    const manager = await org.mkUser("manager");
    managerEmail = manager.email;
    managerPassword = manager.password;
    managerStaffId = manager.staffId;

    const { data: note, error: noteErr } = await org.service
      .from("payroll_recurring_notes")
      .insert({
        organization_id: org.orgId,
        staff_id: managerStaffId,
        kind: "dauer",
        first_period_start: "2026-07-01",
        text: seededText,
      })
      .select("id")
      .single();
    if (noteErr || !note) throw new Error(`recurring-note seed failed: ${noteErr?.message}`);
    seededId = note.id as string;
  });

  afterAll(async () => {
    await org.service.from("payroll_recurring_notes").delete().eq("organization_id", org.orgId);
    await org.cleanup();
  });

  it("(a) manager DIREKT-INSERT wird abgelehnt", async () => {
    const client = await signInAsUser(managerEmail, managerPassword);
    const beforeRes = await org.service
      .from("payroll_recurring_notes")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", org.orgId);
    const before = beforeRes.count ?? 0;

    const { error } = await client.from("payroll_recurring_notes").insert({
      organization_id: org.orgId,
      staff_id: managerStaffId,
      kind: "dauer",
      first_period_start: "2026-08-01",
      text: "hack-insert",
    });
    expect(error).not.toBeNull();

    const afterRes = await org.service
      .from("payroll_recurring_notes")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", org.orgId);
    expect(afterRes.count ?? 0).toBe(before);
  });

  it("(b) manager DIREKT-UPDATE einer bestehenden Zeile wird abgelehnt", async () => {
    const client = await signInAsUser(managerEmail, managerPassword);
    const { data, error } = await client
      .from("payroll_recurring_notes")
      .update({ text: "hack-update" })
      .eq("id", seededId)
      .select("id");
    // Entweder liefert PostgREST einen Fehler oder ein leeres Ergebnis
    // (RLS/Grant-Ablehnung als 0 betroffene Zeilen).
    expect(error !== null || (data ?? []).length === 0).toBe(true);

    const { data: row, error: readErr } = await org.service
      .from("payroll_recurring_notes")
      .select("text")
      .eq("id", seededId)
      .single();
    expect(readErr).toBeNull();
    expect(row?.text).toBe(seededText);
  });
});
