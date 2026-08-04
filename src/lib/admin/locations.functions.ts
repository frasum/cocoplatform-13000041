// Standort-Verwaltung (B1c). Admin legt Standorte an, benennt sie um,
// löscht sie — Löschen NUR möglich, wenn keine staff_locations-Zuordnung
// mehr darauf zeigt.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { loadAdminCaller } from "./admin-context";
import { runGuarded } from "./admin-call";
import { makeAuditWriter } from "./audit";
import { expectMaybe, expectOk, expectVoid } from "@/lib/supabase/expect-ok";

// Optionales Freitext-Feld: leere Strings → null, sonst getrimmt.
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v == null || v === "" ? null : v));

const detailsShape = {
  street: optText(200),
  postal_code: optText(20),
  city: optText(120),
  delivery_notes: optText(500),
  phone: optText(40),
  contact_name: optText(120),
  contact_phone: optText(40),
};

export const listLocations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({ includeInactive: z.boolean().optional() })
      .optional()
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, [
      "manager",
      "admin",
      "payroll",
      "planer",
    ]);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const includeInactive = data?.includeInactive === true;
    let query = supabaseAdmin
      .from("locations")
      .select(
        "id, name, timezone, street, postal_code, city, delivery_notes, phone, contact_name, contact_phone, latitude, longitude, geofence_radius_m, geocoded_at, geocoded_address, cash_balance_target_cents, is_active, cash_enabled, enabled_service_periods, tip_service_pool_enabled, kitchen_tip_rate_override, tip_pool_min_hours_override, kitchen_manual_only_override, tip_distribution_mode_override, tip_distribution_mode_from_override",
      )
      .eq("organization_id", caller.organizationId)
      .order("name");
    if (!includeInactive) query = query.eq("is_active", true);
    const { loadDisabledSessionFieldsByLocation } = await import(
      "@/lib/cash/session-fields-access"
    );
    const [rowsRes, orgRes, disabledByLoc] = await Promise.all([
      query,
      supabaseAdmin
        .from("organizations")
        .select("cash_balance_target_cents")
        .eq("id", caller.organizationId)
        .maybeSingle(),
      // FS1: Session-Feld-Sichtbarkeit je Standort (Shim bis Typ-Regeneration).
      loadDisabledSessionFieldsByLocation(supabaseAdmin, caller.organizationId),
    ]);
    if (rowsRes.error) {
      console.error("[listLocations.rows] Supabase:", rowsRes.error);
      throw new Error(`[listLocations.rows] Supabase: ${rowsRes.error.message}`);
    }
    const rows = rowsRes.data;
    const org = expectMaybe<{ cash_balance_target_cents: number | string | null }>(
      orgRes,
      "listLocations.org",
    );
    const orgTarget = Number(org?.cash_balance_target_cents ?? 200_000);
    return (rows ?? []).map((row) => {
      const raw =
        row.cash_balance_target_cents == null ? null : Number(row.cash_balance_target_cents);
      return {
        ...row,
        isActive: row.is_active !== false,
        // LS1: false = reiner Planungs-Standort (Dienstplan/Zeit ohne Kasse).
        cashEnabled: row.cash_enabled !== false,
        // FS1: am Standort deaktivierte Session-Felder der Kassenmaske.
        disabledSessionFields: disabledByLoc.get(row.id) ?? [],
        cashBalanceTargetCents: raw,
        cashBalanceTargetResolvedCents: raw ?? orgTarget,
      };
    });
  });

export const createLocation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ name: z.string().trim().min(1).max(120), ...detailsShape }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, "admin");
    return runGuarded(caller.role, "admin", makeAuditWriter(caller), async () => {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const row = expectOk<{ id: string }>(
        await supabaseAdmin
          .from("locations")
          .insert({
            organization_id: caller.organizationId,
            name: data.name,
            street: data.street,
            postal_code: data.postal_code,
            city: data.city,
            delivery_notes: data.delivery_notes,
            phone: data.phone,
            contact_name: data.contact_name,
            contact_phone: data.contact_phone,
          })
          .select("id")
          .single(),
        "createLocation",
      );
      return {
        result: { id: row.id },
        audit: {
          action: "location.create",
          entity: "location",
          entityId: row.id,
          meta: { name: data.name },
        },
      };
    });
  });

export const updateLocation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        locationId: z.string().uuid(),
        name: z.string().trim().min(1).max(120),
        cashBalanceTargetCents: z.number().int().min(0).nullable().optional(),
        ...detailsShape,
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, "admin");
    return runGuarded(caller.role, "admin", makeAuditWriter(caller), async () => {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      expectVoid(
        await supabaseAdmin
          .from("locations")
          .update({
            name: data.name,
            street: data.street,
            postal_code: data.postal_code,
            city: data.city,
            delivery_notes: data.delivery_notes,
            phone: data.phone,
            contact_name: data.contact_name,
            contact_phone: data.contact_phone,
            cash_balance_target_cents:
              data.cashBalanceTargetCents === undefined ? undefined : data.cashBalanceTargetCents,
          })
          .eq("id", data.locationId)
          .eq("organization_id", caller.organizationId),
        "updateLocation",
      );
      return {
        result: { ok: true as const },
        audit: {
          action: "location.update",
          entity: "location",
          entityId: data.locationId,
          meta: { name: data.name },
        },
      };
    });
  });

export const deleteLocation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ locationId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, "admin");
    return runGuarded(caller.role, "admin", makeAuditWriter(caller), async () => {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      // Block, falls Mitarbeiter noch zugeordnet sind.
      const countRes = await supabaseAdmin
        .from("staff_locations")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", caller.organizationId)
        .eq("location_id", data.locationId);
      if (countRes.error) throw countRes.error;
      const count = countRes.count;
      if ((count ?? 0) > 0) {
        throw new Error("Standort kann nicht gelöscht werden: noch Mitarbeiter zugeordnet.");
      }
      expectVoid(
        await supabaseAdmin
          .from("locations")
          .delete()
          .eq("id", data.locationId)
          .eq("organization_id", caller.organizationId),
        "deleteLocation",
      );
      return {
        result: { ok: true as const },
        audit: { action: "location.delete", entity: "location", entityId: data.locationId },
      };
    });
  });

// ST1: Aktiv-Schalter. Setzt nur Sichtbarkeit — Daten, Zuordnungen und
// Historie bleiben unangetastet. Reaktivieren jederzeit möglich.
export const setLocationActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ locationId: z.string().uuid(), isActive: z.boolean() }).parse(input),
  )
  // LS1: separater Schalter für „Kassenbetrieb & Auswertungen" siehe unten.
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, "admin");
    return runGuarded(caller.role, "admin", makeAuditWriter(caller), async () => {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const loc = expectMaybe<{ id: string; name: string; is_active: boolean | null }>(
        await supabaseAdmin
          .from("locations")
          .select("id, name, is_active")
          .eq("id", data.locationId)
          .eq("organization_id", caller.organizationId)
          .maybeSingle(),
        "setLocationActive.load",
      );
      if (!loc) throw new Error("Standort nicht gefunden.");
      const alreadyInState = Boolean(loc.is_active) === data.isActive;
      expectVoid(
        await supabaseAdmin
          .from("locations")
          .update({ is_active: data.isActive })
          .eq("id", data.locationId)
          .eq("organization_id", caller.organizationId),
        "setLocationActive.update",
      );
      return {
        result: { ok: true as const, changed: !alreadyInState },
        audit: {
          action: data.isActive ? "location.activated" : "location.deactivated",
          entity: "location",
          entityId: data.locationId,
          meta: { name: loc.name },
        },
      };
    });
  });

// =========================================================================
// Geofencing (B6) — Koordinaten + Radius pro Standort
// =========================================================================

function buildAddress(loc: {
  street: string | null;
  postal_code: string | null;
  city: string | null;
}): string {
  return [loc.street, [loc.postal_code, loc.city].filter(Boolean).join(" ")]
    .filter((s) => s && s.length > 0)
    .join(", ");
}

export const geocodeLocation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ locationId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, "admin");
    return runGuarded(caller.role, "admin", makeAuditWriter(caller), async () => {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const loc = expectMaybe<{
        id: string;
        street: string | null;
        postal_code: string | null;
        city: string | null;
      }>(
        await supabaseAdmin
          .from("locations")
          .select("id, street, postal_code, city")
          .eq("id", data.locationId)
          .eq("organization_id", caller.organizationId)
          .maybeSingle(),
        "geocodeLocation.load",
      );
      if (!loc) throw new Error("Standort nicht gefunden.");
      const address = buildAddress(loc);
      if (!address) throw new Error("Bitte zuerst Straße/PLZ/Ort am Standort eintragen.");

      const { geocodeAddress } = await import("@/lib/geo/geocoding.server");
      const geo = await geocodeAddress(address);

      expectVoid(
        await supabaseAdmin
          .from("locations")
          .update({
            latitude: geo.latitude,
            longitude: geo.longitude,
            geocoded_at: new Date().toISOString(),
            geocoded_address: geo.formattedAddress,
          })
          .eq("id", data.locationId)
          .eq("organization_id", caller.organizationId),
        "geocodeLocation.update",
      );

      return {
        result: {
          latitude: geo.latitude,
          longitude: geo.longitude,
          formattedAddress: geo.formattedAddress,
        },
        audit: {
          action: "location.geocode",
          entity: "location",
          entityId: data.locationId,
          meta: { address, formattedAddress: geo.formattedAddress },
        },
      };
    });
  });

export const updateLocationGeo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        locationId: z.string().uuid(),
        latitude: z.number().min(-90).max(90).nullable(),
        longitude: z.number().min(-180).max(180).nullable(),
        geofenceRadiusM: z.number().int().min(10).max(5000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, "admin");
    return runGuarded(caller.role, "admin", makeAuditWriter(caller), async () => {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      // lat/lng nur paarweise erlaubt
      if ((data.latitude == null) !== (data.longitude == null)) {
        throw new Error("Breiten- und Längengrad nur gemeinsam setzen oder gemeinsam leeren.");
      }
      expectVoid(
        await supabaseAdmin
          .from("locations")
          .update({
            latitude: data.latitude,
            longitude: data.longitude,
            geofence_radius_m: data.geofenceRadiusM,
            geocoded_at: null,
            geocoded_address: null,
          })
          .eq("id", data.locationId)
          .eq("organization_id", caller.organizationId),
        "updateLocationGeo",
      );
      return {
        result: { ok: true as const },
        audit: {
          action: "location.geo_update",
          entity: "location",
          entityId: data.locationId,
          meta: {
            latitude: data.latitude,
            longitude: data.longitude,
            geofenceRadiusM: data.geofenceRadiusM,
          },
        },
      };
    });
  });

// SP2 — Aktive Planungsfenster (frueh/mittag/abend) je Standort setzen.
// Ersetzt den früheren Boolean-Schalter (day_service_enabled). Der alte
// Server-Fn-Alias `setLocationDayServiceEnabled` bleibt bis zur UI-Umstellung
// (Commit 2) als Kompatibilitäts-Wrapper bestehen.
const SERVICE_PERIODS = ["frueh", "mittag", "abend"] as const;
type ServicePeriod = (typeof SERVICE_PERIODS)[number];

function normalizePeriods(input: readonly string[]): ServicePeriod[] {
  const filtered = input.filter((p): p is ServicePeriod =>
    (SERVICE_PERIODS as readonly string[]).includes(p),
  );
  const unique = Array.from(new Set(filtered));
  // Deterministische Reihenfolge früh → mittag → abend.
  unique.sort((a, b) => SERVICE_PERIODS.indexOf(a) - SERVICE_PERIODS.indexOf(b));
  return unique;
}

export const setLocationEnabledServicePeriods = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        locationId: z.string().uuid(),
        periods: z.array(z.enum(SERVICE_PERIODS)).min(1),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, "admin");
    return runGuarded(caller.role, "admin", makeAuditWriter(caller), async () => {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const periods = normalizePeriods(data.periods);
      if (periods.length === 0) {
        throw new Error("Mindestens ein Planungsfenster muss aktiv bleiben.");
      }
      const loc = expectMaybe<{
        id: string;
        name: string;
        enabled_service_periods: string[] | null;
      }>(
        await supabaseAdmin
          .from("locations")
          .select("id, name, enabled_service_periods")
          .eq("id", data.locationId)
          .eq("organization_id", caller.organizationId)
          .maybeSingle(),
        "setLocationEnabledServicePeriods.load",
      );
      if (!loc) throw new Error("Standort nicht gefunden.");
      const before = normalizePeriods((loc.enabled_service_periods as string[] | null) ?? []);
      const changed = before.length !== periods.length || before.some((p, i) => p !== periods[i]);
      if (changed) {
        expectVoid(
          await supabaseAdmin
            .from("locations")
            .update({ enabled_service_periods: periods })
            .eq("id", data.locationId)
            .eq("organization_id", caller.organizationId),
          "setLocationEnabledServicePeriods.update",
        );
      }
      return {
        result: { ok: true as const, changed, periods },
        audit: {
          action: "location.service_periods.update",
          entity: "location",
          entityId: data.locationId,
          meta: { name: loc.name, before, after: periods },
        },
      };
    });
  });

/**
 * Kompatibilitäts-Wrapper: bildet den alten Boolean auf die neue
 * Fenster-Liste ab. Wird in Commit 2 durch den direkten Aufruf von
 * `setLocationEnabledServicePeriods` ersetzt.
 *   enabled=true  → ['mittag','abend']
 *   enabled=false → ['abend']
 */
export const setLocationDayServiceEnabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        locationId: z.string().uuid(),
        enabled: z.boolean(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, "admin");
    return runGuarded(caller.role, "admin", makeAuditWriter(caller), async () => {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const loc = expectMaybe<{
        id: string;
        name: string;
        enabled_service_periods: string[] | null;
      }>(
        await supabaseAdmin
          .from("locations")
          .select("id, name, enabled_service_periods")
          .eq("id", data.locationId)
          .eq("organization_id", caller.organizationId)
          .maybeSingle(),
        "setLocationDayServiceEnabled.load",
      );
      if (!loc) throw new Error("Standort nicht gefunden.");
      const before = normalizePeriods((loc.enabled_service_periods as string[] | null) ?? []);
      const target: ServicePeriod[] = data.enabled ? ["mittag", "abend"] : ["abend"];
      const already = before.length === target.length && before.every((p, i) => p === target[i]);
      if (!already) {
        expectVoid(
          await supabaseAdmin
            .from("locations")
            .update({ enabled_service_periods: target })
            .eq("id", data.locationId)
            .eq("organization_id", caller.organizationId),
          "setLocationDayServiceEnabled.update",
        );
      }
      return {
        result: { ok: true as const, changed: !already },
        audit: {
          action: data.enabled ? "location.day_service.enable" : "location.day_service.disable",
          entity: "location",
          entityId: data.locationId,
          meta: { name: loc.name, before, after: target },
        },
      };
    });
  });

// =========================================================================
// TG1 — Trinkgeld-Einstellungen je Standort (Service-Pool + Overrides)
// =========================================================================

const tipSettingsSchema = z
  .object({
    locationId: z.string().uuid(),
    tipServicePoolEnabled: z.boolean(),
    kitchenTipRateOverride: z.number().min(0).max(0.2).nullable(),
    tipPoolMinHoursOverride: z.number().min(0).max(24).nullable(),
    kitchenManualOnlyOverride: z.boolean().nullable(),
    // TG4 — Modus + Stichtag als Paar: entweder beide leer (Org erbt) oder
    // Modus gesetzt. "headcount" verlangt zusätzlich ein Startdatum.
    tipDistributionModeOverride: z.enum(["hours", "headcount"]).nullable(),
    tipDistributionModeFromOverride: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Stichtag muss ein Datum sein.")
      .nullable(),
  })
  .superRefine((v, ctx) => {
    if (v.tipDistributionModeOverride === "headcount" && !v.tipDistributionModeFromOverride) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tipDistributionModeFromOverride"],
        message: "Kopfteilung braucht ein Startdatum (keine rückwirkende Umstellung).",
      });
    }
    if (v.tipDistributionModeOverride === null && v.tipDistributionModeFromOverride !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tipDistributionModeFromOverride"],
        message: "Stichtag ohne eigenen Modus ist nicht möglich (Standard wird geerbt).",
      });
    }
  });

export const updateLocationTipSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => tipSettingsSchema.parse(input))
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, "manager");
    return runGuarded(caller.role, "manager", makeAuditWriter(caller), async () => {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const loc = expectMaybe<{
        id: string;
        name: string;
        tip_service_pool_enabled: boolean | null;
        kitchen_tip_rate_override: number | string | null;
        tip_pool_min_hours_override: number | string | null;
        kitchen_manual_only_override: boolean | null;
        tip_distribution_mode_override: string | null;
        tip_distribution_mode_from_override: string | null;
      }>(
        await supabaseAdmin
          .from("locations")
          .select(
            "id, name, tip_service_pool_enabled, kitchen_tip_rate_override, tip_pool_min_hours_override, kitchen_manual_only_override, tip_distribution_mode_override, tip_distribution_mode_from_override",
          )
          .eq("id", data.locationId)
          .eq("organization_id", caller.organizationId)
          .maybeSingle(),
        "updateLocationTipSettings.load",
      );
      if (!loc) throw new Error("Standort nicht gefunden.");
      expectVoid(
        await supabaseAdmin
          .from("locations")
          .update({
            tip_service_pool_enabled: data.tipServicePoolEnabled,
            kitchen_tip_rate_override: data.kitchenTipRateOverride,
            tip_pool_min_hours_override: data.tipPoolMinHoursOverride,
            kitchen_manual_only_override: data.kitchenManualOnlyOverride,
            tip_distribution_mode_override: data.tipDistributionModeOverride,
            tip_distribution_mode_from_override: data.tipDistributionModeFromOverride,
          })
          .eq("id", data.locationId)
          .eq("organization_id", caller.organizationId),
        "updateLocationTipSettings.update",
      );
      return {
        result: { ok: true as const },
        audit: {
          action: "location.tip_settings.update",
          entity: "location",
          entityId: data.locationId,
          meta: {
            name: loc.name,
            before: {
              tipServicePoolEnabled: loc.tip_service_pool_enabled,
              kitchenTipRateOverride: loc.kitchen_tip_rate_override,
              tipPoolMinHoursOverride: loc.tip_pool_min_hours_override,
              kitchenManualOnlyOverride: loc.kitchen_manual_only_override,
              tipDistributionModeOverride: loc.tip_distribution_mode_override,
              tipDistributionModeFromOverride: loc.tip_distribution_mode_from_override,
            },
            after: {
              tipServicePoolEnabled: data.tipServicePoolEnabled,
              kitchenTipRateOverride: data.kitchenTipRateOverride,
              tipPoolMinHoursOverride: data.tipPoolMinHoursOverride,
              kitchenManualOnlyOverride: data.kitchenManualOnlyOverride,
              tipDistributionModeOverride: data.tipDistributionModeOverride,
              tipDistributionModeFromOverride: data.tipDistributionModeFromOverride,
            },
          },
        },
      };
    });
  });

// Read-Only: Org-Standards für die Trinkgeld-Einstellungen (nur zur Anzeige
// der Vererbung im Standort-Editor). Manager+ ok.
export const getOrgTipDefaults = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, "manager");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const data = expectMaybe<{
      kitchen_tip_rate: number | string | null;
      tip_pool_min_hours: number | string | null;
      kitchen_manual_only: boolean | null;
      tip_distribution_mode: string | null;
      tip_distribution_mode_from: string | null;
    }>(
      await supabaseAdmin
        .from("organization_settings")
        .select(
          "kitchen_tip_rate, tip_pool_min_hours, kitchen_manual_only, tip_distribution_mode, tip_distribution_mode_from",
        )
        .eq("organization_id", caller.organizationId)
        .maybeSingle(),
      "getOrgTipDefaults",
    );
    return {
      kitchenTipRate: Number(data?.kitchen_tip_rate ?? 0.02),
      tipPoolMinHours: Number(data?.tip_pool_min_hours ?? 2.5),
      kitchenManualOnly: Boolean(data?.kitchen_manual_only ?? false),
      tipDistributionMode: (data?.tip_distribution_mode === "headcount" ? "headcount" : "hours") as
        | "hours"
        | "headcount",
      tipDistributionModeFrom: data?.tip_distribution_mode_from ?? null,
    };
  });

// LS1 — Standort-Merkmal „nur Planung": Kassenbetrieb & Auswertungen
// ein-/ausschalten. Betrifft NUR Kassen-/Statistikpfade; Dienstplan,
// Zeiterfassung und Lohn bleiben unberührt.
export const setLocationCashEnabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ locationId: z.string().uuid(), cashEnabled: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, "admin");
    return runGuarded(caller.role, "admin", makeAuditWriter(caller), async () => {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const loc = expectMaybe<{ id: string; name: string; cash_enabled: boolean | null }>(
        await supabaseAdmin
          .from("locations")
          .select("id, name, cash_enabled")
          .eq("id", data.locationId)
          .eq("organization_id", caller.organizationId)
          .maybeSingle(),
        "setLocationCashEnabled.load",
      );
      if (!loc) throw new Error("Standort nicht gefunden.");
      const alreadyInState = (loc.cash_enabled !== false) === data.cashEnabled;
      expectVoid(
        await supabaseAdmin
          .from("locations")
          .update({ cash_enabled: data.cashEnabled })
          .eq("id", data.locationId)
          .eq("organization_id", caller.organizationId),
        "setLocationCashEnabled.update",
      );
      return {
        result: { ok: true as const, changed: !alreadyInState },
        audit: {
          action: data.cashEnabled ? "location.cash_enabled" : "location.cash_disabled",
          entity: "location",
          entityId: data.locationId,
          meta: { name: loc.name },
        },
      };
    });
  });
