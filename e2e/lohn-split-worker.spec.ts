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

// E2E-G2b Diagnose (Befund B): unter webkit landet der Admin nach dem Login
// nicht auf /admin/lohn-verteilung, sondern auf „/" — das Rollen-Gate in
// src/routes/_authenticated/admin/route.tsx redirectet, wenn getMyIdentity()
// keine Rolle manager+ liefert. Diese Funktion macht dieselbe Auflösung
// sichtbar, die getMyIdentity() serverseitig macht (user_links → staff_id/
// organization_id, dann role_assignments), aber über die REST-API mit dem
// Bearer-Token der Browser-Session. Ändert kein Verhalten, loggt nur.
async function logEffectiveIdentity(page: Page, label: string): Promise<void> {
  const url = process.env.VITE_SUPABASE_URL ?? "";
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "";
  const session = await page.evaluate(() => {
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const k = window.localStorage.key(i);
      if (!k || !/^sb-.*-auth-token$/.test(k)) continue;
      try {
        const raw = window.localStorage.getItem(k);
        const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
        const token = parsed?.["access_token"];
        const user = parsed?.["user"] as { id?: string } | undefined;
        return {
          storageKey: k,
          hasToken: typeof token === "string" && token.length > 0,
          token: typeof token === "string" ? token : null,
          userId: user?.id ?? null,
        };
      } catch {
        return { storageKey: k, hasToken: false, token: null, userId: null };
      }
    }
    return { storageKey: null, hasToken: false, token: null, userId: null };
  });

  if (!url || !key || !session.token || !session.userId) {
    console.log(
      `[${label}] identity-probe unvollständig: url=${url ? "ok" : "leer"} ` +
        `key=${key ? "ok" : "leer"} storageKey=${session.storageKey} ` +
        `hasToken=${session.hasToken} userId=${session.userId} path=${new URL(page.url()).pathname}`,
    );
    return;
  }

  const headers = { apikey: key, Authorization: `Bearer ${session.token}` };
  const linkRes = await page.request.get(
    `${url}/rest/v1/user_links?select=staff_id,organization_id&user_id=eq.${session.userId}`,
    { headers },
  );
  const links = (await linkRes.json().catch(() => null)) as
    | Array<{ staff_id: string; organization_id: string }>
    | null;
  const link = links?.[0] ?? null;

  let role: string | null = null;
  let roleStatus = 0;
  if (link) {
    const roleRes = await page.request.get(
      `${url}/rest/v1/role_assignments?select=role&staff_id=eq.${link.staff_id}` +
        `&organization_id=eq.${link.organization_id}`,
      { headers },
    );
    roleStatus = roleRes.status();
    const roles = (await roleRes.json().catch(() => null)) as Array<{ role: string }> | null;
    role = roles?.[0]?.role ?? null;
  }

  console.log(
    `[${label}] path=${new URL(page.url()).pathname} userId=${session.userId} ` +
      `linkStatus=${linkRes.status()} staffId=${link?.staff_id ?? null} ` +
      `orgId=${link?.organization_id ?? null} roleStatus=${roleStatus} role=${role}`,
  );
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

    // Diagnose vor der Admin-Navigation: welche Rolle sieht das Gate?
    await logEffectiveIdentity(page, "E2E-G2b-webkit");

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
