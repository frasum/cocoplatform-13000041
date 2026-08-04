// UB1 — E2E-Beweis für „Urlaub (unbezahlt)".
//
// Zwei Nachweise, EIN Spec-File:
//   (1) Kalender/Dienstplan: die unbezahlten Tage blocken die Planung wie
//       bezahlter Urlaub — die Zelle trägt den Abwesenheitstyp
//       `urlaub_unbezahlt` (Marker mit Label „Urlaub (unbezahlt)"),
//       die bezahlten Tage weiterhin `urlaub`.
//   (2) Abrechnung: die Diagnosezeile im Brutto/Netto-Tab trennt bezahlt und
//       unbezahlt — Vorschlag U 2 / K 0, unbezahlt 3 (kein Vorschlag).
//
// Prüf-Haken: `roster-cell-<staffId>-<iso>` (Attribut `data-absence`) und
// `absence-diagnose-line`.
//
// Migrations-Ehrlichkeit: Ist die UB1-Migration auf dem Stack NICHT
// angewendet, sind die unbezahlten Tage nicht speicherbar. Dann erwartet der
// Test genau die Migrations-Fehlermeldung (`UB1_MIGRATION_HINT`) statt
// geblockter Tage — eine fehlende Migration darf nicht als UB1-Regression
// erscheinen, und ein grüner Lauf darf sie nicht verschweigen.

import { test, expect, type Locator, type Page } from "@playwright/test";
import { seedUnpaidLeave, UB1_MIGRATION_HINT, type E2EUnpaidLeaveSeed } from "./seed";

/**
 * Fehlt die Migration, ist der einzig korrekte Nachweis die klare
 * Fehlermeldung — der Test bricht dann bewusst mit ihr ab.
 */
function assertMigrationApplied(seed: E2EUnpaidLeaveSeed): void {
  if (seed.unpaidLeaveSupported) {
    expect(seed.migrationError).toBeNull();
    return;
  }
  expect(seed.migrationError).not.toBeNull();
  expect(seed.migrationError).toContain(UB1_MIGRATION_HINT);
  throw new Error(seed.migrationError ?? UB1_MIGRATION_HINT);
}

/**
 * Öffnet Brutto/Netto für die Seed-Person und liefert die Diagnosezeile.
 */
async function openDiagnoseLine(page: Page, seed: E2EUnpaidLeaveSeed): Promise<Locator> {
  await page.goto("/admin/zeit-uebersicht");
  await page.getByRole("button", { name: "Brutto/Netto" }).click();
  await expect(page.getByRole("heading", { name: /Lohnrechner/ })).toBeVisible({
    timeout: 20_000,
  });
  await page.getByText(seed.staffDisplayName, { exact: false }).first().click();
  const line = page.getByTestId("absence-diagnose-line");
  await expect(line).toBeVisible({ timeout: 20_000 });
  return line;
}

/**
 * Liest die Zahlenlage aus der Diagnosezeile — exakt, nicht per Teilstring:
 * die Zeile MUSS „U <n> / K <n> · davon unbezahlt (kein Vorschlag): <n>" sein.
 */
async function readDiagnoseSplit(
  line: Locator,
): Promise<{ urlaub: number; krank: number; unbezahlt: number }> {
  const text = ((await line.textContent()) ?? "").replace(/\s+/g, " ").trim();
  const match = text.match(
    /^Vorschlag aus Kalender: U (\d+) \/ K (\d+) · davon unbezahlt \(kein Vorschlag\): (\d+)$/,
  );
  expect(match, `Diagnosezeile hat unerwartete Form: "${text}"`).not.toBeNull();
  return {
    urlaub: Number(match![1]),
    krank: Number(match![2]),
    unbezahlt: Number(match![3]),
  };
}

async function loginAsAdmin(page: Page, seed: E2EUnpaidLeaveSeed): Promise<void> {
  await page.goto("/auth");
  await page.getByPlaceholder("E-Mail").fill(seed.adminEmail);
  await page.getByPlaceholder("Passwort").fill(seed.adminPassword);
  await page.getByRole("button", { name: /Anmelden/ }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/auth"), { timeout: 15_000 });
}

test.describe("Urlaub (unbezahlt) — UB1", () => {
  let seed: E2EUnpaidLeaveSeed | null = null;

  test.afterEach(async () => {
    if (seed) {
      await seed.cleanup();
      seed = null;
    }
  });

  test("(1) Kalender blockt unbezahlte Tage wie Urlaub", async ({ page }) => {
    seed = await seedUnpaidLeave("ub1-kalender");
    assertMigrationApplied(seed);
    await loginAsAdmin(page, seed);

    await page.goto("/admin/dienstplan?ansicht=grid&bereich=service");

    const firstUnpaid = page.getByTestId(`roster-cell-${seed.staffId}-${seed.unpaidDays[0]}`);
    await expect(firstUnpaid).toBeVisible({ timeout: 20_000 });

    // Unbezahlte Tage: geblockt, eigener Typ.
    for (const iso of seed.unpaidDays) {
      await expect(page.getByTestId(`roster-cell-${seed.staffId}-${iso}`)).toHaveAttribute(
        "data-absence",
        "urlaub_unbezahlt",
      );
    }
    // Bezahlte Tage bleiben unverändert `urlaub`.
    for (const iso of seed.paidDays) {
      await expect(page.getByTestId(`roster-cell-${seed.staffId}-${iso}`)).toHaveAttribute(
        "data-absence",
        "urlaub",
      );
    }
    // Der Marker nennt den Typ im Klartext.
    await firstUnpaid.hover();
    await expect(page.getByText("Urlaub (unbezahlt)").first()).toBeVisible();
  });

  test("(2) Diagnosezeile trennt bezahlt und unbezahlt", async ({ page }) => {
    seed = await seedUnpaidLeave("ub1-diagnose");
    assertMigrationApplied(seed);
    await loginAsAdmin(page, seed);

    const line = await openDiagnoseLine(page, seed);
    // Referenzfenster vollständig bearbeitet → Schätzung = Kalendertage.
    // Exakte Aufteilung: bezahlt im Vorschlag, unbezahlt getrennt ausgewiesen.
    const split = await readDiagnoseSplit(line);
    expect(split).toEqual({
      urlaub: seed.paidDays.length,
      krank: 0,
      unbezahlt: seed.unpaidDays.length,
    });
    // Der Vorschlag enthält die unbezahlten Tage NICHT (keine Doppelzählung).
    expect(split.urlaub + split.unbezahlt).toBe(seed.paidDays.length + seed.unpaidDays.length);
  });

  test("(4) Diagnosezeile bleibt bei geänderter Zahlenlage konsistent", async ({ page }) => {
    seed = await seedUnpaidLeave("ub1-diagnose-shift");
    assertMigrationApplied(seed);
    await loginAsAdmin(page, seed);

    const total = seed.paidDays.length + seed.unpaidDays.length;

    const before = await readDiagnoseSplit(await openDiagnoseLine(page, seed));
    expect(before).toEqual({ urlaub: 2, krank: 0, unbezahlt: 3 });

    // Zahlenlage 1: ein unbezahlter Tag wird bezahlt → 3 / 0 / 2.
    await seed.setAbsenceType(seed.unpaidDays[0]!, "urlaub");
    const afterPaid = await readDiagnoseSplit(await openDiagnoseLine(page, seed));
    expect(afterPaid).toEqual({ urlaub: 3, krank: 0, unbezahlt: 2 });
    expect(afterPaid.urlaub + afterPaid.krank + afterPaid.unbezahlt).toBe(total);

    // Zahlenlage 2: ein weiterer unbezahlter Tag wird krank → 3 / 1 / 1.
    await seed.setAbsenceType(seed.unpaidDays[1]!, "krank");
    const afterSick = await readDiagnoseSplit(await openDiagnoseLine(page, seed));
    expect(afterSick).toEqual({ urlaub: 3, krank: 1, unbezahlt: 1 });
    expect(afterSick.urlaub + afterSick.krank + afterSick.unbezahlt).toBe(total);
  });

  test("(3) fehlende UB1-Migration meldet sich als Migrations-Fehler", async () => {
    seed = await seedUnpaidLeave("ub1-migration");

    if (!seed.unpaidLeaveSupported) {
      // Erwarteter Zustand OHNE Migration: klare Ursache, keine Tage geblockt.
      expect(seed.migrationError).toContain(UB1_MIGRATION_HINT);
      expect(seed.migrationError).toContain("ub1-roster-absence-urlaub-unbezahlt.sql");
      // Ohne Migration darf der Zähl-Filter selbst fehlschlagen; entscheidend
      // ist, dass KEIN unbezahlter Tag gespeichert (und damit geblockt) ist.
      const { count } = await seed.countStoredUnpaidDays();
      expect(count).toBe(0);
      return;
    }

    // Erwarteter Zustand MIT Migration: kein Fehler, alle Tage gespeichert.
    expect(seed.migrationError).toBeNull();
    const { count, error } = await seed.countStoredUnpaidDays();
    expect(error).toBeNull();
    expect(count).toBe(seed.unpaidDays.length);
  });
});
