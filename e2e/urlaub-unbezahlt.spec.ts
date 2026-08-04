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

import { test, expect, type Page } from "@playwright/test";
import { seedUnpaidLeave, type E2EUnpaidLeaveSeed } from "./seed";

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
});
