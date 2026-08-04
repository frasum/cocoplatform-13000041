// WX3-a — Täglicher Wetter-Abruf (pg_cron). Public-Route, ausschließlich per
// timing-safem X-Cron-Secret geschützt (kein Login-Kontext, kein zweiter
// Schlüsselweg). Muster wie /api/public/telegram/daily-report.
//
// Bewusst KEIN Zeit-Gate: der Sync ist durch mayOverwrite idempotent, ein
// Doppellauf schadet nicht.

import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export const Route = createFileRoute("/api/public/weather/sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.WEATHER_CRON_SECRET;
        if (!expected) {
          return new Response("Wetter-Cron-Secret nicht konfiguriert", { status: 503 });
        }
        const actual = request.headers.get("X-Cron-Secret") ?? "";
        if (!safeEqual(actual, expected)) {
          return new Response("Unauthorized", { status: 401 });
        }

        const { listAllOrganizationIds, runWeatherSyncForOrgs } = await import(
          "@/lib/weather/weather-sync.server"
        );
        const orgIds = await listAllOrganizationIds();
        const results = await runWeatherSyncForOrgs(orgIds);
        return Response.json({ ok: true, results });
      },
    },
  },
});
