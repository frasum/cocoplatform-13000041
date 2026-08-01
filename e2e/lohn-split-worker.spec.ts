// Bundle-Diet — E2E-Beweis, dass beim Aufteilen eines mehrseitigen
// Sammel-Lohn-PDFs genau EIN pdfjs-Worker-Chunk (`pdf.worker.min-*.mjs`)
// vom Browser nachgeladen wird. Regression-Schutz für die pdfjs-Dublette,
// die auf Branch `feature/bundle-diet` auf den Legacy-Build vereinheitlicht
// wurde (siehe `PdfCanvasPreview.tsx`, `split-combined.ts`).
//
// Der Test seedet nur einen Admin (über den vorhandenen Kassen-Seed —
// zusätzliche Objekte sind für diesen Pfad irrelevant), erzeugt in-place
// ein 3-seitiges PDF mit extrahierbarem Text („Personal-Nr. …" + Monat),
// lädt es im UI hoch und beobachtet Response-URLs. Keine echten
// Personaldaten, keine Fixture-PDFs im Repo (Lektion „thaitime").

import { test, expect, type Page } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { seedKasseFinalize, type E2ESeed } from "./seed";

// Muss BEIDE Namensformen treffen: der Produktionsbuild hängt einen
// Content-Hash an (`pdf.worker.min-XYZ.mjs`), der Dev-Server (die Suite läuft
// per `bun run dev`, siehe playwright.config.ts) liefert die Datei ohne Hash
// aus (`/node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs`). Die
// frühere Fassung verlangte den Bindestrich und traf im Dev-Lauf NICHTS —
// daher „erwartet 1, geladen 0".
const WORKER_RE = /pdf\.worker(?:\.min)?(?:-[^/]*)?\.m?js(?:\?|$)/;

/** Dateiname ohne Query/Hash — Dev und Build sollen gleich gezählt werden. */
function workerKey(url: string): string {
  const file = url.split("?")[0].split("/").pop() ?? url;
  return file.replace(/-[^.]*(?=\.m?js$)/, "");
}

async function loginAsAdmin(page: Page, seed: E2ESeed): Promise<void> {
  await page.goto("/auth");
  await page.getByPlaceholder("E-Mail").fill(seed.adminEmail);
  await page.getByPlaceholder("Passwort").fill(seed.adminPassword);
  await page.getByRole("button", { name: /Anmelden/ }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/auth"), { timeout: 15_000 });
}

async function buildCombinedPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  // Zwei Personen, 3 Seiten (000001 hat 2 Seiten) → deckt Gruppierung ab.
  const pages = [
    { perso: "000001", label: "Seite 1/2" },
    { perso: "000001", label: "Seite 2/2" },
    { perso: "000002", label: "Seite 1/1" },
  ];
  for (const p of pages) {
    const page = doc.addPage([595, 842]);
    page.drawText(`Personal-Nr. ${p.perso}`, { x: 50, y: 780, size: 14, font });
    page.drawText("Juni 2026", { x: 50, y: 750, size: 12, font });
    page.drawText(`E2E-Fixture ${p.label}`, { x: 50, y: 720, size: 10, font });
  }
  return Buffer.from(await doc.save());
}

test.describe("Lohn-Verteilung: Sammel-PDF splitten (Bundle-Diet)", () => {
  let seed: E2ESeed | null = null;

  test.afterEach(async () => {
    if (seed) {
      await seed.cleanup();
      seed = null;
    }
  });

  test("lädt genau EINEN pdf.worker-Chunk und splittet ohne Fehler", async ({ page }) => {
    seed = await seedKasseFinalize("bundle-diet", { withServiceHours: true });
    await loginAsAdmin(page, seed);

    // Worker-Requests VOR der Navigation zu /admin/lohn-verteilung
    // beobachten — sonst entgehen uns eventuelle Preloads.
    const workerUrls = new Set<string>();
    page.on("response", (res) => {
      const url = res.url();
      if (WORKER_RE.test(url)) workerUrls.add(workerKey(url));
    });

    await page.goto("/admin/lohn-verteilung");
    await expect(page.getByRole("heading", { name: "Lohn PDF Import" })).toBeVisible();

    const pdfBytes = await buildCombinedPdf();
    // Erster File-Input auf der Seite = „Sammel-PDF aufteilen".
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: "sammel-2026-06.pdf",
      mimeType: "application/pdf",
      buffer: pdfBytes,
    });

    // Splitting abgeschlossen: Zusammenfassungszeile erscheint.
    await expect(page.getByText(/3 Seiten .* 2 Mitarbeiter/)).toBeVisible({ timeout: 20_000 });

    // Kein splitError im UI.
    await expect(page.locator("text=/Teile PDF auf…/")).toHaveCount(0);
    const errors = await page.locator(".text-destructive").allTextContents();
    for (const t of errors) {
      expect(t).not.toMatch(/split|fehler|error/i);
    }

    // Kernaussage: genau EIN pdfjs-Worker-Chunk wurde geladen.
    expect(
      Array.from(workerUrls),
      `Erwartet genau 1 pdf.worker-Chunk, geladen: ${JSON.stringify(Array.from(workerUrls))}`,
    ).toHaveLength(1);
  });
});
