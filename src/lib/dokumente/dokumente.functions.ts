// V1 Dokumentengenerierung — Server-Functions.
//
// Alle admin-gated. Schreibende Funktionen laufen über runGuarded + writeAuditLog.
// Audit-Meta enthält NIEMALS Dokumentinhalte oder Platzhalterwerte (SV-Nr/IBAN
// gehören nicht ins Log).

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { loadAdminCaller } from "@/lib/admin/admin-context";
import { runGuarded } from "@/lib/admin/admin-call";
import { makeAuditWriter } from "@/lib/admin/audit";
import {
  buildPlaceholderData,
  fillTemplate,
  listPlaceholdersInTemplate,
  type PlaceholderInput,
} from "./document-placeholders";
import { formatWageLines, resolveWageLines } from "./wage-lines";
import type { RateRow } from "@/lib/lohn/rate-resolution";
import type { Department } from "@/lib/time/primary-department";

const DOC_TYPES = ["arbeitsvertrag", "arbeitszeugnis_einfach", "arbeitsbescheinigung"] as const;
export type DocType = (typeof DOC_TYPES)[number];

export type DocumentTemplateRow = {
  id: string;
  docType: DocType;
  name: string;
  content: string;
  isActive: boolean;
  updatedAt: string;
};

export type GeneratedDocumentRow = {
  id: string;
  staffId: string;
  templateId: string | null;
  docType: string;
  title: string;
  createdAt: string;
  createdByName: string | null;
};

export type GeneratedDocumentFull = GeneratedDocumentRow & {
  content: string;
  metadata: { unresolved?: string[] };
};

export type DocumentPreview = {
  text: string;
  unresolved: string[];
};

// ── Templates ──────────────────────────────────────────────────────────────

export const listTemplates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DocumentTemplateRow[]> => {
    const caller = await loadAdminCaller(context.supabase, context.userId, "admin");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("document_templates")
      .select("id, doc_type, name, content, is_active, updated_at")
      .eq("organization_id", caller.organizationId)
      .order("doc_type")
      .order("name");
    if (error) throw error;
    return (data ?? []).map((t) => ({
      id: t.id,
      docType: t.doc_type as DocType,
      name: t.name,
      content: t.content,
      isActive: t.is_active,
      updatedAt: t.updated_at,
    }));
  });

export const createTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        docType: z.enum(DOC_TYPES),
        name: z.string().trim().min(1).max(200),
        content: z.string().min(1),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, "admin");
    const write = makeAuditWriter(caller);
    return runGuarded(caller.role, "admin", write, async () => {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: row, error } = await supabaseAdmin
        .from("document_templates")
        .insert({
          organization_id: caller.organizationId,
          doc_type: data.docType,
          name: data.name,
          content: data.content,
        })
        .select("id")
        .single();
      if (error) throw error;
      return {
        result: { id: row.id },
        audit: {
          action: "document_template.created",
          entity: "document_template",
          entityId: row.id,
          meta: { name: data.name, docType: data.docType },
        },
      };
    });
  });

export const updateTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        id: z.string().uuid(),
        name: z.string().trim().min(1).max(200).optional(),
        content: z.string().min(1).optional(),
        isActive: z.boolean().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, "admin");
    const write = makeAuditWriter(caller);
    return runGuarded(caller.role, "admin", write, async () => {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: existing, error: eErr } = await supabaseAdmin
        .from("document_templates")
        .select("id, name")
        .eq("id", data.id)
        .eq("organization_id", caller.organizationId)
        .maybeSingle();
      if (eErr) throw eErr;
      if (!existing) throw new Error("Template nicht gefunden.");

      const patch: {
        name?: string;
        content?: string;
        is_active?: boolean;
      } = {};
      if (data.name !== undefined) patch.name = data.name;
      if (data.content !== undefined) patch.content = data.content;
      if (data.isActive !== undefined) patch.is_active = data.isActive;
      if (Object.keys(patch).length === 0) {
        return {
          result: { ok: true as const },
          audit: {
            action: "document_template.updated",
            entity: "document_template",
            entityId: data.id,
            meta: { name: existing.name, changed: [] as string[] },
          },
        };
      }

      const { error: uErr } = await supabaseAdmin
        .from("document_templates")
        .update(patch)
        .eq("id", data.id)
        .eq("organization_id", caller.organizationId);
      if (uErr) throw uErr;

      return {
        result: { ok: true as const },
        audit: {
          action: "document_template.updated",
          entity: "document_template",
          entityId: data.id,
          meta: {
            name: data.name ?? existing.name,
            changed: Object.keys(patch),
          },
        },
      };
    });
  });

// ── Data-Loading + Preview + Save ──────────────────────────────────────────

async function loadPlaceholderInput(
  organizationId: string,
  staffId: string,
): Promise<PlaceholderInput> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: staff, error: sErr } = await supabaseAdmin
    .from("staff")
    .select("id, first_name, last_name, contracted_hours_per_month")
    .eq("id", staffId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (sErr) throw sErr;
  if (!staff) throw new Error("Mitarbeiter nicht gefunden.");

  const [detailsRes, ratesRes, settingsRes, locRes] = await Promise.all([
    supabaseAdmin
      .from("staff_personal_details")
      .select(
        "salutation, date_of_birth, place_of_birth, nationality, address, social_security_number, tax_id, tax_class, health_insurance, employment_start_date, iban",
      )
      .eq("staff_id", staffId)
      .maybeSingle(),
    supabaseAdmin
      .from("staff_compensation_rates")
      .select("department, valid_from, hourly_rate")
      .eq("staff_id", staffId),
    supabaseAdmin
      .from("organization_settings")
      .select("arbeitgeber_name, arbeitgeber_adresse, arbeitgeber_vertreter")
      .eq("organization_id", organizationId)
      .maybeSingle(),
    supabaseAdmin
      .from("staff_locations")
      .select("location_id, locations(name)")
      .eq("staff_id", staffId),
  ]);
  if (detailsRes.error) throw detailsRes.error;
  if (ratesRes.error) throw ratesRes.error;
  if (settingsRes.error) throw settingsRes.error;
  if (locRes.error) throw locRes.error;

  const locations = locRes.data ?? [];
  // "standort" wird nur befüllt, wenn genau ein Standort zugeordnet ist.
  const location =
    locations.length === 1
      ? {
          name:
            (locations[0] as unknown as { locations: { name: string } | null }).locations?.name ??
            null,
        }
      : null;

  const { todayIso } = await import("@/lib/format");
  const today = todayIso();
  // LG3b/ST1-B — EUR→Cents genau hier, am IO-Rand.
  const rates: RateRow[] = (ratesRes.data ?? []).map((r) => ({
    department: r.department as Department,
    validFrom: r.valid_from as string,
    hourlyRateCents: Math.round(Number(r.hourly_rate) * 100),
  }));
  const wageText = formatWageLines(resolveWageLines(rates, today));

  return {
    staff: { first_name: staff.first_name, last_name: staff.last_name },
    details: detailsRes.data ?? null,
    compensation: {
      wage_text: wageText,
      contracted_hours_per_month: staff.contracted_hours_per_month,
    },
    organization: settingsRes.data ?? null,
    location,
    today,
  };
}

export const previewDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({ staffId: z.string().uuid(), templateId: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }): Promise<DocumentPreview> => {
    const caller = await loadAdminCaller(context.supabase, context.userId, "admin");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: tpl, error: tErr } = await supabaseAdmin
      .from("document_templates")
      .select("content")
      .eq("id", data.templateId)
      .eq("organization_id", caller.organizationId)
      .maybeSingle();
    if (tErr) throw tErr;
    if (!tpl) throw new Error("Template nicht gefunden.");

    const input = await loadPlaceholderInput(caller.organizationId, data.staffId);
    const values = buildPlaceholderData(input);
    return fillTemplate(tpl.content, values);
  });

export const saveGeneratedDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        staffId: z.string().uuid(),
        templateId: z.string().uuid(),
        title: z.string().trim().min(1).max(300),
        content: z.string().min(1),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, "admin");
    if (!caller.staffId) throw new Error("Kein Staff-Kontext.");
    const callerStaffId = caller.staffId;
    const write = makeAuditWriter(caller);
    return runGuarded(caller.role, "admin", write, async () => {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

      const { data: tpl, error: tErr } = await supabaseAdmin
        .from("document_templates")
        .select("id, doc_type")
        .eq("id", data.templateId)
        .eq("organization_id", caller.organizationId)
        .maybeSingle();
      if (tErr) throw tErr;
      if (!tpl) throw new Error("Template nicht gefunden.");

      const { data: staff, error: sErr } = await supabaseAdmin
        .from("staff")
        .select("id")
        .eq("id", data.staffId)
        .eq("organization_id", caller.organizationId)
        .maybeSingle();
      if (sErr) throw sErr;
      if (!staff) throw new Error("Mitarbeiter nicht gefunden.");

      const unresolved = listPlaceholdersInTemplate(data.content);

      const { data: row, error: iErr } = await supabaseAdmin
        .from("generated_documents")
        .insert({
          organization_id: caller.organizationId,
          staff_id: data.staffId,
          template_id: tpl.id,
          doc_type: tpl.doc_type,
          title: data.title,
          content: data.content,
          metadata: { unresolved },
          created_by: callerStaffId,
        })
        .select("id")
        .single();
      if (iErr) throw iErr;

      return {
        result: { id: row.id, unresolved },
        audit: {
          action: "document.generated",
          entity: "generated_document",
          entityId: row.id,
          // Keine Inhalte, keine Platzhalterwerte im Audit.
          meta: {
            staffId: data.staffId,
            docType: tpl.doc_type,
            title: data.title,
            unresolvedCount: unresolved.length,
          },
        },
      };
    });
  });

export const listGeneratedDocuments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ staffId: z.string().uuid().optional() }).parse(i ?? {}))
  .handler(async ({ data, context }): Promise<GeneratedDocumentRow[]> => {
    const caller = await loadAdminCaller(context.supabase, context.userId, "admin");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let q = supabaseAdmin
      .from("generated_documents")
      .select("id, staff_id, template_id, doc_type, title, created_at, created_by")
      .eq("organization_id", caller.organizationId)
      .order("created_at", { ascending: false });
    if (data.staffId) q = q.eq("staff_id", data.staffId);

    const { data: rows, error } = await q;
    if (error) throw error;

    const createdByIds = Array.from(
      new Set((rows ?? []).map((r) => r.created_by).filter((v): v is string => !!v)),
    );
    const nameMap = new Map<string, string>();
    if (createdByIds.length > 0) {
      const { data: authors } = await supabaseAdmin
        .from("staff")
        .select("id, display_name")
        .in("id", createdByIds);
      for (const a of authors ?? []) nameMap.set(a.id, a.display_name);
    }

    return (rows ?? []).map((r) => ({
      id: r.id,
      staffId: r.staff_id,
      templateId: r.template_id,
      docType: r.doc_type,
      title: r.title,
      createdAt: r.created_at,
      createdByName: nameMap.get(r.created_by) ?? null,
    }));
  });

export const getGeneratedDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }): Promise<GeneratedDocumentFull> => {
    const caller = await loadAdminCaller(context.supabase, context.userId, "admin");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: row, error } = await supabaseAdmin
      .from("generated_documents")
      .select(
        "id, staff_id, template_id, doc_type, title, content, metadata, created_at, created_by",
      )
      .eq("id", data.id)
      .eq("organization_id", caller.organizationId)
      .maybeSingle();
    if (error) throw error;
    if (!row) throw new Error("Dokument nicht gefunden.");

    let createdByName: string | null = null;
    if (row.created_by) {
      const { data: a } = await supabaseAdmin
        .from("staff")
        .select("display_name")
        .eq("id", row.created_by)
        .maybeSingle();
      createdByName = a?.display_name ?? null;
    }

    return {
      id: row.id,
      staffId: row.staff_id,
      templateId: row.template_id,
      docType: row.doc_type,
      title: row.title,
      content: row.content,
      metadata: (row.metadata as { unresolved?: string[] }) ?? {},
      createdAt: row.created_at,
      createdByName,
    };
  });
