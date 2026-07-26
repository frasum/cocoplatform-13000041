// Self-Service-Profil (SP1) — Mitarbeiter-Ebene.
// staffId/organizationId werden IMMER aus dem Caller genommen, nie vom Client.
// Alle Schreibpfade laufen über runGuarded + writeAudit; Audit-Meta enthält
// bei sensiblen Vorgängen NUR Feldnamen, keine Werte.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { loadAdminCaller } from "@/lib/admin/admin-context";
import { assertRealIdentity } from "@/lib/admin/impersonation";
import { runGuarded } from "@/lib/admin/admin-call";
import { makeAuditWriter } from "@/lib/admin/audit";
import { ForbiddenError } from "@/lib/admin/role-guard";
import {
  DIRECT_EDIT_FIELDS,
  SELF_VIEW_FIELDS,
  normalizeRequestValue,
  validateChangeRequestPayload,
  validateDirectEditPayload,
  type DirectEditField,
  type RequestField,
} from "./profile-fields";
import {
  ALLOWED_DOC_MIME,
  DOC_TYPES,
  MAX_DOC_SIZE_BYTES,
  extensionForMime,
  isStaffDocumentPathAllowed,
  sanitizeDocumentFileName,
  staffDocumentFolder,
  type StaffDocumentType,
} from "./staff-document-path";

const BUCKET = "staff-documents";

type JsonPrimitive = string | number | boolean | null;
type SelfViewValue = JsonPrimitive;

function pickSelfView(
  row: Record<string, unknown> | null,
): Partial<Record<(typeof SELF_VIEW_FIELDS)[number], SelfViewValue>> {
  if (!row) return {};
  const out: Partial<Record<(typeof SELF_VIEW_FIELDS)[number], SelfViewValue>> = {};
  for (const f of SELF_VIEW_FIELDS) {
    if (f in row) {
      const v = row[f];
      if (v === null || v === undefined) out[f] = null;
      else if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[f] = v;
      else out[f] = String(v);
    }
  }
  return out;
}

export type MyProfile = {
  staff: {
    firstName: string | null;
    lastName: string | null;
    displayName: string | null;
  };
  details: Partial<Record<(typeof SELF_VIEW_FIELDS)[number], SelfViewValue>>;
};

export const getMyProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MyProfile> => {
    const caller = await loadAdminCaller(context.supabase, context.userId, "staff");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [staffRes, detailsRes] = await Promise.all([
      supabaseAdmin
        .from("staff")
        .select("first_name, last_name, display_name")
        .eq("id", caller.staffId)
        .maybeSingle(),
      supabaseAdmin
        .from("staff_personal_details")
        .select(SELF_VIEW_FIELDS.join(","))
        .eq("staff_id", caller.staffId)
        .maybeSingle(),
    ]);
    if (staffRes.error) throw new Error(staffRes.error.message);
    if (detailsRes.error) throw new Error(detailsRes.error.message);
    return {
      staff: {
        firstName: staffRes.data?.first_name ?? null,
        lastName: staffRes.data?.last_name ?? null,
        displayName: staffRes.data?.display_name ?? null,
      },
      details: pickSelfView(detailsRes.data as Record<string, unknown> | null),
    };
  });

const contactSchema = z
  .object({
    address: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().optional(),
  })
  .refine((o) => Object.keys(o).length > 0, "Keine Änderungen angegeben.");

export const updateMyContact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => contactSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const caller = await loadAdminCaller(context.supabase, context.userId, "staff");
    assertRealIdentity(caller);
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
      if (v !== undefined) cleaned[k] = v;
    }
    const validation = validateDirectEditPayload(cleaned);
    if (!validation.ok) {
      throw new Error(Object.values(validation.errors).join(" "));
    }
    return runGuarded(caller.role, "staff", makeAuditWriter(caller), async () => {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: before, error: beforeErr } = await supabaseAdmin
        .from("staff_personal_details")
        .select(DIRECT_EDIT_FIELDS.join(","))
        .eq("staff_id", caller.staffId)
        .maybeSingle();
      if (beforeErr) throw new Error(beforeErr.message);

      const upsertRow = {
        staff_id: caller.staffId,
        organization_id: caller.organizationId,
        ...validation.value,
      };
      const { error: upErr } = await supabaseAdmin
        .from("staff_personal_details")
        .upsert(upsertRow, { onConflict: "staff_id" });
      if (upErr) throw new Error(upErr.message);

      const diff: Record<string, { before: unknown; after: unknown }> = {};
      for (const k of Object.keys(validation.value) as DirectEditField[]) {
        const beforeVal = (before as Record<string, unknown> | null)?.[k] ?? null;
        diff[k] = { before: beforeVal, after: validation.value[k] };
      }
      return {
        result: { ok: true as const },
        audit: {
          action: "profile.contact_update",
          entity: "staff_personal_details",
          entityId: caller.staffId,
          meta: { diff },
        },
      };
    });
  });

const submitSchema = z.object({
  payload: z.record(z.string(), z.unknown()),
  note: z.string().max(2000).optional(),
});

export const submitChangeRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => submitSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const caller = await loadAdminCaller(context.supabase, context.userId, "staff");
    assertRealIdentity(caller);
    const validation = validateChangeRequestPayload(data.payload);
    if (!validation.ok) {
      throw new Error(Object.values(validation.errors).join(" "));
    }
    const normalized: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(validation.value)) {
      normalized[k] = normalizeRequestValue(k as RequestField, v);
      if (v !== null && normalized[k] === null) {
        throw new Error(`Antragswert für ${k} konnte nicht normalisiert werden.`);
      }
    }
    return runGuarded(caller.role, "staff", makeAuditWriter(caller), async () => {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: inserted, error } = await supabaseAdmin
        .from("staff_data_change_requests")
        .insert({
          organization_id: caller.organizationId,
          staff_id: caller.staffId,
          payload: normalized as unknown as import("@/integrations/supabase/types").Json,
          note: data.note ?? null,
        })
        .select("id")
        .single();
      if (error) {
        if (
          error.code === "23505" ||
          /sdcr_one_pending_per_staff|duplicate key/i.test(error.message)
        ) {
          throw new Error("Es liegt bereits ein offener Antrag vor.");
        }
        throw new Error(error.message);
      }
      return {
        result: { id: inserted.id },
        audit: {
          action: "profile.request_submitted",
          entity: "staff_data_change_requests",
          entityId: inserted.id,
          // Nur Feldnamen, KEINE Werte (sensible Daten).
          meta: { fields: Object.keys(normalized) },
        },
      };
    });
  });

export type MyChangeRequest = {
  id: string;
  status: "pending" | "approved" | "rejected";
  fields: string[];
  note: string | null;
  reviewNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
};

export const listMyChangeRequests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MyChangeRequest[]> => {
    const caller = await loadAdminCaller(context.supabase, context.userId, "staff");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("staff_data_change_requests")
      .select("id, status, payload, note, review_note, created_at, reviewed_at")
      .eq("staff_id", caller.staffId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({
      id: r.id as string,
      status: r.status as MyChangeRequest["status"],
      fields: Object.keys((r.payload ?? {}) as Record<string, unknown>),
      note: (r.note as string | null) ?? null,
      reviewNote: (r.review_note as string | null) ?? null,
      createdAt: r.created_at as string,
      reviewedAt: (r.reviewed_at as string | null) ?? null,
    }));
  });

const uploadSchema = z.object({
  docType: z.enum(DOC_TYPES),
  fileName: z.string().min(1),
  contentBase64: z.string().min(1),
  mimeType: z.string().min(1),
  validUntil: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  note: z.string().max(1000).optional(),
});

function decodeBase64Length(b64: string): number {
  // Länge der dekodierten Bytes berechnen, ohne alles zu materialisieren.
  const clean = b64.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) return -1;
  const pad = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  return Math.floor((clean.length * 3) / 4) - pad;
}

export const uploadMyDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => uploadSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ id: string; path: string }> => {
    const caller = await loadAdminCaller(context.supabase, context.userId, "staff");
    assertRealIdentity(caller);
    const ext = extensionForMime(data.mimeType);
    if (!ext) throw new Error("Dateityp nicht erlaubt (nur JPG/PNG/PDF).");
    if (!ALLOWED_DOC_MIME[data.mimeType]) throw new Error("Dateityp nicht erlaubt.");
    const size = decodeBase64Length(data.contentBase64);
    if (size <= 0) throw new Error("Datei ist ungültig.");
    if (size > MAX_DOC_SIZE_BYTES) throw new Error("Datei ist zu groß (max. 10 MB).");
    const originalName = sanitizeDocumentFileName(data.fileName);
    if (!originalName) throw new Error("Ungültiger Dateiname.");

    return runGuarded(caller.role, "staff", makeAuditWriter(caller), async () => {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const folder = staffDocumentFolder(
        caller.organizationId,
        caller.staffId,
        data.docType as StaffDocumentType,
      );
      const uuid = crypto.randomUUID();
      const path = `${folder}/${uuid}.${ext}`;
      const bytes = Uint8Array.from(atob(data.contentBase64.replace(/\s+/g, "")), (c) =>
        c.charCodeAt(0),
      );
      const { error: upErr } = await supabaseAdmin.storage
        .from(BUCKET)
        .upload(path, bytes, { contentType: data.mimeType, upsert: false });
      if (upErr) throw new Error(upErr.message);
      const { data: inserted, error: insErr } = await supabaseAdmin
        .from("staff_documents")
        .insert({
          organization_id: caller.organizationId,
          staff_id: caller.staffId,
          doc_type: data.docType,
          file_path: path,
          original_filename: originalName,
          mime_type: data.mimeType,
          size_bytes: size,
          valid_until: data.validUntil ?? null,
          note: data.note ?? null,
          uploaded_by: caller.staffId,
        })
        .select("id")
        .single();
      if (insErr) {
        // Rollback: hochgeladene Datei entfernen.
        await supabaseAdmin.storage.from(BUCKET).remove([path]);
        throw new Error(insErr.message);
      }
      return {
        result: { id: inserted.id, path },
        audit: {
          action: "profile.document_uploaded",
          entity: "staff_documents",
          entityId: inserted.id,
          meta: { docType: data.docType, filename: originalName },
        },
      };
    });
  });

export type MyDocument = {
  id: string;
  docType: StaffDocumentType;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  validUntil: string | null;
  note: string | null;
  verifiedAt: string | null;
  createdAt: string;
};

export const listMyDocuments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MyDocument[]> => {
    const caller = await loadAdminCaller(context.supabase, context.userId, "staff");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("staff_documents")
      .select(
        "id, doc_type, original_filename, mime_type, size_bytes, valid_until, note, verified_at, created_at",
      )
      .eq("staff_id", caller.staffId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({
      id: r.id as string,
      docType: r.doc_type as StaffDocumentType,
      originalFilename: r.original_filename as string,
      mimeType: r.mime_type as string,
      sizeBytes: Number(r.size_bytes),
      validUntil: (r.valid_until as string | null) ?? null,
      note: (r.note as string | null) ?? null,
      verifiedAt: (r.verified_at as string | null) ?? null,
      createdAt: r.created_at as string,
    }));
  });

export const getMyDocumentUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ documentId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ url: string }> => {
    const caller = await loadAdminCaller(context.supabase, context.userId, "staff");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: doc, error } = await supabaseAdmin
      .from("staff_documents")
      .select("staff_id, organization_id, file_path")
      .eq("id", data.documentId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!doc || doc.staff_id !== caller.staffId) throw new ForbiddenError();
    if (
      !isStaffDocumentPathAllowed(doc.file_path as string, caller.organizationId, caller.staffId)
    ) {
      throw new ForbiddenError();
    }
    const { data: signed, error: signErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .createSignedUrl(doc.file_path as string, 60);
    if (signErr || !signed) throw new Error(signErr?.message ?? "Signed URL fehlgeschlagen.");
    return { url: signed.signedUrl };
  });
