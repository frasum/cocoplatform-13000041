// P2 — Seed-Helfer für die E2E-Suite (Kassen-Finalize).
//
// Baut auf demselben lokalen Supabase-Stack auf, den `src/test/db-setup.ts`
// benutzt (`supabase start`, Service-Role gegen `http://127.0.0.1:54321`).
// Der Helfer legt in EINEM Aufruf einen kompletten Test-Cluster an:
//   * Organisation + Standort (München-Marienplatz-Geofence)
//   * Admin-Konto (auth.users + user_link + role_assignment 'admin' +
//     staff_locations) mit bekanntem Passwort aus `E2E_PASSWORD`
//   * Service-Mitarbeiter mit geschlossenem `time_entries`-Eintrag am
//     Test-Geschäftstag (Variante `withServiceHours: false` lässt den
//     Eintrag weg — für den Pool-Warnungs-Pfad)
//   * Offene Session am aktuellen Geschäftstag
//   * Eine `submitted` Kellnerabrechnung mit Werten, aus denen ein
//     positiver Service-Pool entsteht (POS 100.00 €, Karte 20.00 €,
//     Bareinlage 80.00 €).
//
// Idempotent: fester Präfix pro Lauf via Zeitstempel/Zufall, `cleanup()`
// räumt alles wieder auf; parallele Läufe kollidieren nicht.
//
// HARTE SICHERUNG: der Seed verweigert den Start, sobald `SUPABASE_URL`
// nicht auf `localhost`/`127.0.0.1` zeigt. Damit ist Produktions-Zugriff
// aus der E2E-Suite ausgeschlossen (Lektion "thaitime").

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const PASSWORD = process.env.E2E_PASSWORD ?? "Test-Password-123!";

function assertLocalhost(): void {
  const url = process.env.SUPABASE_URL ?? "";
  const ok = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(url);
  if (!ok) {
    throw new Error(
      `E2E-Seed abgebrochen: SUPABASE_URL zeigt nicht auf localhost (aktuell: '${url}'). ` +
        "Kein Zugriff auf Produktions- oder Remote-Datenbanken erlaubt.",
    );
  }
}

function service(): SupabaseClient {
  assertLocalhost();
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY fehlt für E2E-Seed.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type E2ESeed = {
  orgId: string;
  locationId: string;
  adminEmail: string;
  adminPassword: string;
  adminStaffId: string;
  serviceStaffId: string;
  sessionId: string;
  businessDate: string;
  cleanup: () => Promise<void>;
};

export type E2ESeedOptions = {
  /** Trägt einen geschlossenen `time_entries`-Eintrag für den Service-Mitarbeiter ein
   *  (Default). Bei `false` bleibt der Tag ohne anrechenbare Stunden — der Finalize
   *  läuft in den Pool-Warndialog. */
  withServiceHours?: boolean;
};

export async function seedKasseFinalize(
  label: string,
  opts: E2ESeedOptions = {},
): Promise<E2ESeed> {
  const withHours = opts.withServiceHours ?? true;
  const svc = service();
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const orgName = `e2e-${label}-${suffix}`;

  const { data: org, error: orgErr } = await svc
    .from("organizations")
    .insert({ name: orgName })
    .select("id")
    .single();
  if (orgErr || !org) throw new Error(`org insert failed: ${orgErr?.message}`);
  const orgId = org.id as string;

  const { data: loc, error: locErr } = await svc
    .from("locations")
    .insert({
      organization_id: orgId,
      name: "E2E-Standort",
      latitude: 48.137154,
      longitude: 11.575382,
      geofence_radius_m: 100,
    })
    .select("id")
    .single();
  if (locErr || !loc) throw new Error(`location insert failed: ${locErr?.message}`);
  const locationId = loc.id as string;

  const createdUserIds: string[] = [];
  const createdStaffIds: string[] = [];

  async function mkUser(role: "admin" | "manager" | "staff", tag: string) {
    const email = `${tag}-${suffix}@e2e.local`;
    const { data: u, error: uErr } = await svc.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    });
    if (uErr || !u.user) throw new Error(`auth createUser failed: ${uErr?.message}`);
    createdUserIds.push(u.user.id);

    const { data: staff, error: sErr } = await svc
      .from("staff")
      .insert({
        organization_id: orgId,
        first_name: tag,
        last_name: "E2E",
        display_name: `${tag} E2E`,
        email,
        is_active: true,
        // E2E-Nutzer überspringen den Erst-Login-Passwortwechsel (Route-Guard).
        must_change_password: false,
      })
      .select("id")
      .single();
    if (sErr || !staff) throw new Error(`staff insert failed: ${sErr?.message}`);
    createdStaffIds.push(staff.id as string);

    const { error: linkErr } = await svc.from("user_links").insert({
      user_id: u.user.id,
      staff_id: staff.id,
      organization_id: orgId,
    });
    if (linkErr) throw new Error(`user_links insert failed: ${linkErr.message}`);

    const { error: raErr } = await svc.from("role_assignments").insert({
      staff_id: staff.id,
      organization_id: orgId,
      role,
    });
    if (raErr) throw new Error(`role_assignments insert failed: ${raErr.message}`);

    const { error: slErr } = await svc.from("staff_locations").insert({
      organization_id: orgId,
      staff_id: staff.id,
      location_id: locationId,
      department: "service",
    });
    if (slErr) throw new Error(`staff_locations insert failed: ${slErr.message}`);

    return { userId: u.user.id as string, staffId: staff.id as string, email };
  }

  const admin = await mkUser("admin", "admin");
  const waiter = await mkUser("staff", "kellner");

  const { data: bd, error: bdErr } = await svc.rpc("current_business_date");
  if (bdErr) throw new Error(`current_business_date failed: ${bdErr.message}`);
  const businessDate = bd as unknown as string;

  if (withHours) {
    // Geschlossener Zeiteintrag (15:00–23:00 lokale Zeit) → 8h eligible.
    const startISO = new Date(`${businessDate}T15:00:00Z`).toISOString();
    const endISO = new Date(`${businessDate}T23:00:00Z`).toISOString();
    const { error: teErr } = await svc.from("time_entries").insert({
      organization_id: orgId,
      staff_id: waiter.staffId,
      location_id: locationId,
      business_date: businessDate,
      started_at: startISO,
      ended_at: endISO,
      // Bewusst ohne department: Pool nutzt staff_locations.department; vermeidet den PostgREST-Schema-Cache-Bug (PGRST204) auf frischen Stacks.
    });
    if (teErr) throw new Error(`time_entries insert failed: ${teErr.message}`);

    // E2E-G2b Diagnose: trennt Kandidat 1 (Query-Achse org+location+business_date
    // trifft die Zeile nicht) von Kandidat 2 (Bereichs-Auflösung liefert den
    // Kellner nicht). Ausgabe landet im Playwright-Log des CI-Laufs.
    // Produktachse abgelesen aus computeSessionTipPoolCore
    // (src/lib/cash/cash.functions.ts): time_entries
    //   .select("staff_id, started_at, ended_at")
    //   .eq organization_id / .eq location_id / .eq business_date
    //   .not("ended_at", "is", null)
    // Der Readback spiegelt genau diese Achse (plus id für die Zuordnung) und
    // loggt zusätzlich die Variante OHNE ended_at-Filter, damit ein offener
    // Eintrag als Ursache erkennbar wäre.
    const { data: diagTe } = await svc
      .from("time_entries")
      .select("id, staff_id, business_date, location_id, started_at, ended_at")
      .eq("organization_id", orgId)
      .eq("location_id", locationId)
      .eq("business_date", businessDate);
    const { data: diagTeProd } = await svc
      .from("time_entries")
      .select("staff_id, started_at, ended_at")
      .eq("organization_id", orgId)
      .eq("location_id", locationId)
      .eq("business_date", businessDate)
      .not("ended_at", "is", null);
    const { data: diagSl } = await svc
      .from("staff_locations")
      .select("staff_id, department, location_id")
      .eq("staff_id", waiter.staffId);
    console.log(
      `[E2E-G2b] te-hits=${diagTe?.length ?? 0} prod-axis-hits=${diagTeProd?.length ?? 0} ` +
        `te=${JSON.stringify(diagTe)} prodTe=${JSON.stringify(diagTeProd)} ` +
        `sl=${JSON.stringify(diagSl)} ` +
        `sessionDate=${businessDate} loc=${locationId} waiter=${waiter.staffId}`,
    );
  }

  const { data: sess, error: sessErr } = await svc
    .from("sessions")
    .insert({
      organization_id: orgId,
      location_id: locationId,
      business_date: businessDate,
      status: "open",
      guest_count: 25, // Finalize-Voraussetzung (Button sperrt bei 0)
      vectron_daily_total_cents: 100000, // = Summe Kellner-Umsätze → POS-Abgleich sauber
    })
    .select("id")
    .single();
  if (sessErr || !sess) throw new Error(`session insert failed: ${sessErr?.message}`);
  const sessionId = sess.id as string;

  // Kellnerabrechnung: 100 € POS − 20 € Karte − 80 € Bar = 0 Differenz;
  // Pool entsteht aus den Trinkgeld-Feldern der Kalkulation (siehe
  // `tip-pool.ts`). Werte gespiegelt aus `cash-finalize.db.test.ts`.
  //
  // Küchen-Trinkgeld je Variante (E2E-G2): Seit der Verschärfung vom
  // 13.07. warnt TG1 JE POOL (`poolFullyUnallocated`), nicht mehr nur bei
  // aggregierten 0 Minuten. Der Seed legt kein Küchen-Personal an — ein
  // gefüllter Küchen-Pool würde die Warnung also immer auslösen und der
  // „Happy Path" (sowie die Ruhetag-Variante) prüfte in Wahrheit den
  // Warnpfad. Nur `poolwarn` braucht den gefüllten Pool ohne Stunden.
  const wantsPoolWarning = label === "poolwarn";
  const { error: wsErr } = await svc.from("waiter_settlements").insert({
    organization_id: orgId,
    session_id: sessionId,
    staff_id: waiter.staffId,
    pos_sales_cents: 100000,
    card_total_cents: 20000,
    hilf_mahl_cents: 0,
    open_invoices_cents: 0,
    cash_handed_in_cents: 80000,
    kitchen_tip_rate: wantsPoolWarning ? 0.02 : 0,
    kitchen_tip_cents: wantsPoolWarning ? 2000 : 0,
    status: "submitted",
  });
  if (wsErr) throw new Error(`waiter_settlements insert failed: ${wsErr.message}`);

  const cleanup = async () => {
    await svc.from("audit_log").delete().eq("organization_id", orgId);
    await svc.from("sessions").delete().eq("organization_id", orgId);
    await svc.from("time_entries").delete().eq("organization_id", orgId);
    await svc.from("location_calendar_exceptions").delete().eq("location_id", locationId);
    await svc.from("location_rest_days").delete().eq("location_id", locationId);
    await svc.from("role_assignments").delete().eq("organization_id", orgId);
    await svc.from("user_links").delete().eq("organization_id", orgId);
    await svc.from("staff_locations").delete().eq("organization_id", orgId);
    if (createdStaffIds.length > 0) {
      await svc.from("staff").delete().in("id", createdStaffIds);
    }
    await svc.from("locations").delete().eq("organization_id", orgId);
    await svc.from("organizations").delete().eq("id", orgId);
    for (const uid of createdUserIds) {
      await svc.auth.admin.deleteUser(uid).catch(() => undefined);
    }
  };

  return {
    orgId,
    locationId,
    adminEmail: admin.email,
    adminPassword: PASSWORD,
    adminStaffId: admin.staffId,
    serviceStaffId: waiter.staffId,
    sessionId,
    businessDate,
    cleanup,
  };
}

/** Legt eine Kalender-Ausnahme "closed" für den Standort/Tag an (RT1-Pfad). */
export async function markLocationClosed(
  locationId: string,
  organizationId: string,
  date: string,
): Promise<void> {
  const svc = service();
  const { error } = await svc.from("location_calendar_exceptions").insert({
    organization_id: organizationId,
    location_id: locationId,
    date,
    kind: "closed",
  });
  if (error) throw new Error(`calendar exception insert failed: ${error.message}`);
}

/** Zählt Audit-Log-Einträge mit `meta.poolHoursWarningConfirmed = true`. */
export async function findPoolWarningAuditRow(
  organizationId: string,
  sessionId: string,
): Promise<{ meta: Record<string, unknown> } | null> {
  const svc = service();
  const { data, error } = await svc
    .from("audit_log")
    .select("meta")
    .eq("organization_id", organizationId)
    .eq("action", "cash.session.finalized")
    .eq("entity_id", sessionId)
    .limit(1);
  if (error) throw new Error(`audit_log query failed: ${error.message}`);
  const row = data?.[0];
  if (!row) return null;
  return { meta: (row.meta ?? {}) as Record<string, unknown> };
}

// ---------------------------------------------------------------------------
// UB1 — Seed für „Urlaub (unbezahlt)".
//
// Baut einen minimalen Cluster (Organisation, Standort, Admin, ein planbarer
// Service-Mitarbeiter) und darauf:
//   * Periode = Mo–So der aktuellen Woche (der Lohnrechner wählt genau die
//     Periode, in der „heute" liegt),
//   * Kalender: Mo+Di `urlaub`, Mi+Do+Fr `urlaub_unbezahlt`,
//   * Referenzfenster: geschlossene Zeiteinträge auf ALLEN 91 Tagen vor
//     Periodenbeginn → workRate = 1, damit die Diagnose-Schätzung exakt den
//     Kalendertagen entspricht (U 2 / unbezahlt 3) und nicht rundet,
//   * Personaldaten + Stundensatz, damit die Lohnvorschau ohne Fehler rechnet.
//
// Schlägt der Insert von `urlaub_unbezahlt` fehl (CHECK-Constraint auf
// `roster_absence.type` noch nicht migriert), bricht der Seed mit klarer
// Ursache ab — kein stiller Grün-Lauf.

export type E2EUnpaidLeaveSeed = {
  orgId: string;
  locationId: string;
  adminEmail: string;
  adminPassword: string;
  staffId: string;
  staffDisplayName: string;
  periodStart: string;
  periodEnd: string;
  /** Mo+Di — bezahlter Urlaub. */
  paidDays: string[];
  /** Mi+Do+Fr — unbezahlter Urlaub. */
  unpaidDays: string[];
  /**
   * UB1-Migration auf diesem Stack vorhanden? Wenn nein, ist
   * `urlaub_unbezahlt` nicht speicherbar — dann steht der Grund in
   * `migrationError` und die unbezahlten Tage sind NICHT geblockt.
   */
  unpaidLeaveSupported: boolean;
  /** Klartext-Fehlermeldung des abgelehnten Inserts (sonst null). */
  migrationError: string | null;
  cleanup: () => Promise<void>;
};

function isoPlus(isoDate: string, delta: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** Montag (UTC) der Woche, in der `today` liegt. */
function mondayOfWeek(todayIso: string): string {
  const d = new Date(`${todayIso}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0 = So
  const delta = dow === 0 ? -6 : 1 - dow;
  return isoPlus(todayIso, delta);
}

export async function seedUnpaidLeave(label: string): Promise<E2EUnpaidLeaveSeed> {
  const svc = service();
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const { data: org, error: orgErr } = await svc
    .from("organizations")
    .insert({ name: `e2e-${label}-${suffix}` })
    .select("id")
    .single();
  if (orgErr || !org) throw new Error(`org insert failed: ${orgErr?.message}`);
  const orgId = org.id as string;

  const { data: loc, error: locErr } = await svc
    .from("locations")
    .insert({
      organization_id: orgId,
      name: "E2E-Standort",
      latitude: 48.137154,
      longitude: 11.575382,
      geofence_radius_m: 100,
    })
    .select("id")
    .single();
  if (locErr || !loc) throw new Error(`location insert failed: ${locErr?.message}`);
  const locationId = loc.id as string;

  const createdUserIds: string[] = [];
  const createdStaffIds: string[] = [];

  async function mkUser(role: "admin" | "staff", tag: string) {
    const email = `${tag}-${suffix}@e2e.local`;
    const { data: u, error: uErr } = await svc.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    });
    if (uErr || !u.user) throw new Error(`auth createUser failed: ${uErr?.message}`);
    createdUserIds.push(u.user.id);

    const displayName = `${tag} E2E`;
    const { data: staff, error: sErr } = await svc
      .from("staff")
      .insert({
        organization_id: orgId,
        first_name: tag,
        last_name: "E2E",
        display_name: displayName,
        email,
        is_active: true,
        must_change_password: false,
      })
      .select("id")
      .single();
    if (sErr || !staff) throw new Error(`staff insert failed: ${sErr?.message}`);
    createdStaffIds.push(staff.id as string);

    const { error: linkErr } = await svc
      .from("user_links")
      .insert({ user_id: u.user.id, staff_id: staff.id, organization_id: orgId });
    if (linkErr) throw new Error(`user_links insert failed: ${linkErr.message}`);

    const { error: raErr } = await svc
      .from("role_assignments")
      .insert({ staff_id: staff.id, organization_id: orgId, role });
    if (raErr) throw new Error(`role_assignments insert failed: ${raErr.message}`);

    const { error: slErr } = await svc.from("staff_locations").insert({
      organization_id: orgId,
      staff_id: staff.id,
      location_id: locationId,
      department: "service",
    });
    if (slErr) throw new Error(`staff_locations insert failed: ${slErr.message}`);

    return { staffId: staff.id as string, email, displayName };
  }

  const admin = await mkUser("admin", "admin");
  const worker = await mkUser("staff", "urlauber");

  const { data: bd, error: bdErr } = await svc.rpc("current_business_date");
  if (bdErr) throw new Error(`current_business_date failed: ${bdErr.message}`);
  const today = bd as unknown as string;

  const monday = mondayOfWeek(today);
  const periodStart = monday;
  const periodEnd = isoPlus(monday, 6);
  const paidDays = [isoPlus(monday, 0), isoPlus(monday, 1)];
  const unpaidDays = [isoPlus(monday, 2), isoPlus(monday, 3), isoPlus(monday, 4)];

  const { error: perErr } = await svc.from("periods").insert({
    organization_id: orgId,
    label: `E2E-KW ${periodStart}`,
    start_date: periodStart,
    end_date: periodEnd,
  });
  if (perErr) throw new Error(`periods insert failed: ${perErr.message}`);

  // Personaldaten + Stundensatz: ohne beides bricht die Lohnvorschau ab.
  const { error: pdErr } = await svc.from("staff_personal_details").insert({
    organization_id: orgId,
    staff_id: worker.staffId,
    tax_class: 1,
    soll_hours_per_day: 8,
  });
  if (pdErr) throw new Error(`staff_personal_details insert failed: ${pdErr.message}`);

  const { error: rateErr } = await svc.from("staff_compensation_rates").insert({
    staff_id: worker.staffId,
    organization_id: orgId,
    department: "service",
    valid_from: isoPlus(periodStart, -365),
    hourly_rate: 15,
  });
  if (rateErr) throw new Error(`staff_compensation_rates insert failed: ${rateErr.message}`);

  // Referenzfenster (91 Tage vor Periodenbeginn) vollständig bearbeitet →
  // workRate = 1 → Diagnose-Schätzung = Kalendertage (exakt prüfbar).
  const refEntries = Array.from({ length: 91 }, (_, i) => {
    const day = isoPlus(periodStart, -91 + i);
    return {
      organization_id: orgId,
      staff_id: worker.staffId,
      location_id: locationId,
      business_date: day,
      started_at: new Date(`${day}T10:00:00Z`).toISOString(),
      ended_at: new Date(`${day}T18:00:00Z`).toISOString(),
    };
  });
  const { error: teErr } = await svc.from("time_entries").insert(refEntries);
  if (teErr) throw new Error(`time_entries insert failed: ${teErr.message}`);

  // Bezahlter Urlaub muss immer gehen — schlägt er fehl, ist der Stack kaputt
  // und nicht bloß die UB1-Migration nicht angewendet.
  const { error: paidErr } = await svc.from("roster_absence").insert(
    paidDays.map((date) => ({
      organization_id: orgId,
      staff_id: worker.staffId,
      date,
      type: "urlaub",
    })),
  );
  if (paidErr) throw new Error(`roster_absence (urlaub) insert failed: ${paidErr.message}`);

  // Der unbezahlte Urlaub ist der Migrations-Prüfstein: fehlt die UB1-
  // Migration, lehnt der CHECK den Typ ab. Das ist KEIN Seed-Abbruch,
  // sondern ein prüfbarer Zustand — der Test darf dann genau die
  // Fehlermeldung erwarten statt geblockter Tage (§104-Ehrlichkeitsregel).
  const { error: unpaidErr } = await svc.from("roster_absence").insert(
    unpaidDays.map((date) => ({
      organization_id: orgId,
      staff_id: worker.staffId,
      date,
      type: "urlaub_unbezahlt",
    })),
  );
  const unpaidLeaveSupported = !unpaidErr;
  const migrationError = unpaidErr ? `${UB1_MIGRATION_HINT} (${unpaidErr.message})` : null;

  const cleanup = async () => {
    await svc.from("audit_log").delete().eq("organization_id", orgId);
    await svc.from("roster_absence").delete().eq("organization_id", orgId);
    await svc.from("roster_shifts").delete().eq("organization_id", orgId);
    await svc.from("time_entries").delete().eq("organization_id", orgId);
    await svc.from("lohn_absence_days").delete().eq("organization_id", orgId);
    await svc.from("staff_compensation_rates").delete().eq("organization_id", orgId);
    await svc.from("staff_personal_details").delete().eq("organization_id", orgId);
    await svc.from("periods").delete().eq("organization_id", orgId);
    await svc.from("role_assignments").delete().eq("organization_id", orgId);
    await svc.from("user_links").delete().eq("organization_id", orgId);
    await svc.from("staff_locations").delete().eq("organization_id", orgId);
    if (createdStaffIds.length > 0) await svc.from("staff").delete().in("id", createdStaffIds);
    await svc.from("locations").delete().eq("organization_id", orgId);
    await svc.from("organizations").delete().eq("id", orgId);
    for (const uid of createdUserIds) {
      await svc.auth.admin.deleteUser(uid).catch(() => undefined);
    }
  };

  return {
    orgId,
    locationId,
    adminEmail: admin.email,
    adminPassword: PASSWORD,
    staffId: worker.staffId,
    staffDisplayName: worker.displayName,
    periodStart,
    periodEnd,
    paidDays,
    unpaidDays,
    unpaidLeaveSupported,
    migrationError,
    cleanup,
  };
}
