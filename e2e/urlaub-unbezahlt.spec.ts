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

import { test, expect, type Page } from "@playwright/test";
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

    await page.goto("/admin/zeit-uebersicht");
    await page.getByRole("button", { name: "Brutto/Netto" }).click();

    await expect(page.getByRole("heading", { name: /Lohnrechner/ })).toBeVisible({
      timeout: 20_000,
    });

    // Person in der Übersicht anklicken → Detail (inkl. Diagnosezeile).
    await page.getByText(seed.staffDisplayName, { exact: false }).first().click();

    const line = page.getByTestId("absence-diagnose-line");
    await expect(line).toBeVisible({ timeout: 20_000 });
    // Referenzfenster vollständig bearbeitet → Schätzung = Kalendertage.
    await expect(line).toContainText("U 2 / K 0");
    await expect(line).toContainText("unbezahlt (kein Vorschlag): 3");
  });

  test("(3) fehlende UB1-Migration meldet sich als Migrations-Fehler", async () => {
    seed = await seedUnpaidLeave("ub1-migration");

    if (!seed.unpaidLeaveSupported) {
      // Erwarteter Zustand OHNE Migration: klare Ursache, keine Tage geblockt.
      expect(seed.migrationError).toContain(UB1_MIGRATION_HINT);
      expect(seed.migrationError).toContain("ub1-roster-absence-urlaub-unbezahlt.sql");
      const { count, error } = await seed.countStoredUnpaidDays();
      expect(error).toBeNull();
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
