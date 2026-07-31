// TG1 — Vererbte Trinkgeld-Einstellungen (Org-Standard → Standort-Override).
//
// Alle Trinkgeld-Pfade laden ihre Parameter über diesen Loader, damit
// Standort-Overrides überall wirken. `loadOrgSettings` bleibt für Nicht-
// Trinkgeld-Nutzer (Wasserlinie etc.) unverändert bestehen.

import type { TipDistributionMode } from "./tip-pool";

export type TipSettings = {
  servicePoolEnabled: boolean;
  kitchenTipRate: number;
  tipPoolMinHours: number;
  kitchenManualOnly: boolean;
  // TG4 — Rohwerte; der Stichtag wird NICHT hier aufgelöst (kein business_date
  // bekannt), sondern von resolveTipDistributionMode am Aufrufort.
  distributionMode: TipDistributionMode;
  distributionModeFrom: string | null;
};

export type TipSettingsInput = {
  org: {
    kitchenTipRate: number;
    tipPoolMinHours: number;
    kitchenManualOnly: boolean;
    distributionMode: TipDistributionMode;
    distributionModeFrom: string | null;
  };
  location: {
    tipServicePoolEnabled: boolean;
    kitchenTipRateOverride: number | null;
    tipPoolMinHoursOverride: number | null;
    kitchenManualOnlyOverride: boolean | null;
    distributionModeOverride: TipDistributionMode | null;
    distributionModeFromOverride: string | null;
  } | null;
};

/**
 * Reine COALESCE-Vererbung. Wird von `loadTipSettings` und Tests genutzt.
 *
 * TG4-Abweichung (bewusst): Verteilmodus + Stichtag erben als PAAR, nicht
 * feldweise. Ist `distributionModeOverride` gesetzt, gelten beide
 * Standortwerte — auch ein Stichtag von NULL. Sonst gelten beide Org-Werte.
 * Feldweise Vererbung erlaubte sonst „Standort-Stichtag + Org-Modus", was
 * fachlich nicht interpretierbar ist.
 */
export function mergeTipSettings(input: TipSettingsInput): TipSettings {
  const loc = input.location;
  const modePair =
    loc?.distributionModeOverride != null
      ? { mode: loc.distributionModeOverride, from: loc.distributionModeFromOverride }
      : { mode: input.org.distributionMode, from: input.org.distributionModeFrom };
  return {
    servicePoolEnabled: loc?.tipServicePoolEnabled ?? true,
    kitchenTipRate: loc?.kitchenTipRateOverride ?? input.org.kitchenTipRate,
    tipPoolMinHours: loc?.tipPoolMinHoursOverride ?? input.org.tipPoolMinHours,
    kitchenManualOnly: loc?.kitchenManualOnlyOverride ?? input.org.kitchenManualOnly,
    distributionMode: modePair.mode,
    distributionModeFrom: modePair.from,
  };
}

export async function loadTipSettings(orgId: string, locationId: string): Promise<TipSettings> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const [orgRes, locRes] = await Promise.all([
    supabaseAdmin
      .from("organization_settings")
      .select(
        "kitchen_tip_rate, tip_pool_min_hours, kitchen_manual_only, tip_distribution_mode, tip_distribution_mode_from",
      )
      .eq("organization_id", orgId)
      .maybeSingle(),
    supabaseAdmin
      .from("locations")
      .select(
        "tip_service_pool_enabled, kitchen_tip_rate_override, tip_pool_min_hours_override, kitchen_manual_only_override, tip_distribution_mode_override, tip_distribution_mode_from_override",
      )
      .eq("id", locationId)
      .eq("organization_id", orgId)
      .maybeSingle(),
  ]);
  if (orgRes.error) throw orgRes.error;
  if (locRes.error) throw locRes.error;
  return mergeTipSettings({
    org: {
      kitchenTipRate: Number(orgRes.data?.kitchen_tip_rate ?? 0.02),
      tipPoolMinHours: Number(orgRes.data?.tip_pool_min_hours ?? 2.5),
      kitchenManualOnly: Boolean(orgRes.data?.kitchen_manual_only ?? false),
      distributionMode: orgRes.data?.tip_distribution_mode === "headcount" ? "headcount" : "hours",
      distributionModeFrom: orgRes.data?.tip_distribution_mode_from ?? null,
    },
    location: locRes.data
      ? {
          tipServicePoolEnabled: locRes.data.tip_service_pool_enabled ?? true,
          kitchenTipRateOverride:
            locRes.data.kitchen_tip_rate_override == null
              ? null
              : Number(locRes.data.kitchen_tip_rate_override),
          tipPoolMinHoursOverride:
            locRes.data.tip_pool_min_hours_override == null
              ? null
              : Number(locRes.data.tip_pool_min_hours_override),
          kitchenManualOnlyOverride:
            locRes.data.kitchen_manual_only_override == null
              ? null
              : Boolean(locRes.data.kitchen_manual_only_override),
          distributionModeOverride:
            locRes.data.tip_distribution_mode_override === "headcount"
              ? "headcount"
              : locRes.data.tip_distribution_mode_override === "hours"
                ? "hours"
                : null,
          distributionModeFromOverride: locRes.data.tip_distribution_mode_from_override ?? null,
        }
      : null,
  });
}
