import { describe, expect, it } from "vitest";
import {
  pickOrphanAccounts,
  readProviderName,
  readStaffIdHint,
  type AuthUserLike,
} from "./orphan-accounts";

describe("pickOrphanAccounts", () => {
  it("filtert verknüpfte Nutzer heraus", () => {
    const users: AuthUserLike[] = [
      { id: "a", email: "a@x", created_at: "2026-01-01", last_sign_in_at: null },
      { id: "b", email: "b@x", created_at: "2026-01-01", last_sign_in_at: null },
    ];
    const result = pickOrphanAccounts(users, new Set(["a"]));
    expect(result.map((r) => r.userId)).toEqual(["b"]);
  });

  it("bildet Felder korrekt ab (email/created/lastSignIn)", () => {
    const users: AuthUserLike[] = [
      { id: "b", email: "b@x", created_at: "2026-01-02", last_sign_in_at: "2026-05-01" },
    ];
    expect(pickOrphanAccounts(users, new Set())).toEqual([
      { userId: "b", email: "b@x", createdAt: "2026-01-02", lastSignInAt: "2026-05-01" },
    ]);
  });

  it("Mandanten-Leck: Konto einer FREMDEN Organisation darf nicht als verwaist erscheinen", () => {
    // linkedUserIds ist projektweit — enthält Ids aus Org A und Org B.
    // Nur „orphan" (nirgendwo verknüpft) bleibt übrig.
    const users: AuthUserLike[] = [
      { id: "orgA-user", email: "a@x" },
      { id: "orgB-user", email: "b@x" },
      { id: "orphan", email: "o@x" },
    ];
    const linked = new Set(["orgA-user", "orgB-user"]);
    const result = pickOrphanAccounts(users, linked);
    expect(result.map((r) => r.userId)).toEqual(["orphan"]);
  });

  it("sortiert: lastSignInAt schlägt createdAt; ohne beide ans Ende", () => {
    const users: AuthUserLike[] = [
      { id: "old-created", created_at: "2026-01-01", last_sign_in_at: null },
      { id: "recent-signin", created_at: "2020-01-01", last_sign_in_at: "2026-06-01" },
      { id: "no-dates" },
    ];
    const result = pickOrphanAccounts(users, new Set());
    expect(result.map((r) => r.userId)).toEqual(["recent-signin", "old-created", "no-dates"]);
  });

  it("stabile Reihenfolge bei identischem Sortierwert (Tiebreak userId)", () => {
    const users: AuthUserLike[] = [
      { id: "u-b", created_at: "2026-01-01", last_sign_in_at: "2026-05-01" },
      { id: "u-a", created_at: "2026-01-01", last_sign_in_at: "2026-05-01" },
      { id: "u-c", created_at: "2026-01-01", last_sign_in_at: "2026-05-01" },
    ];
    const result = pickOrphanAccounts(users, new Set());
    expect(result.map((r) => r.userId)).toEqual(["u-a", "u-b", "u-c"]);
  });

  it("fehlende Felder werden zu null, nicht undefined", () => {
    const users: AuthUserLike[] = [{ id: "x" }];
    const [row] = pickOrphanAccounts(users, new Set());
    expect(row).toEqual({
      userId: "x",
      email: null,
      createdAt: null,
      lastSignInAt: null,
      providerName: null,
      linkedStaffId: null,
      kind: "foreign",
    });
    expect(row.email).toBeNull();
    expect(row.createdAt).toBeNull();
    expect(row.lastSignInAt).toBeNull();
  });
});

describe("readProviderName (SP1)", () => {
  it("liest full_name; name nur wenn full_name fehlt; preferred_username als letzte Stufe", () => {
    expect(
      readProviderName({ id: "x", user_metadata: { full_name: "A", name: "B", preferred_username: "C" } }),
    ).toBe("A");
    expect(readProviderName({ id: "x", user_metadata: { name: "B", preferred_username: "C" } })).toBe("B");
    expect(readProviderName({ id: "x", user_metadata: { preferred_username: "C" } })).toBe("C");
    expect(readProviderName({ id: "x", user_metadata: null })).toBeNull();
    expect(readProviderName({ id: "x" })).toBeNull();
  });
  it("Nicht-String-Werte werden zu null (kein Absturz)", () => {
    expect(readProviderName({ id: "x", user_metadata: { full_name: 42 } })).toBeNull();
    expect(readProviderName({ id: "x", user_metadata: { full_name: { nested: "x" } } })).toBeNull();
    expect(readProviderName({ id: "x", user_metadata: { full_name: null } })).toBeNull();
  });
});

describe("readStaffIdHint & kind (SP1)", () => {
  const STAFF_ID = "11111111-2222-3333-4444-555555555555";
  it("app_metadata.staff_id → linkedStaffId gesetzt, kind = broken_link", () => {
    const [row] = pickOrphanAccounts(
      [{ id: "u1", app_metadata: { staff_id: STAFF_ID } }],
      new Set(),
    );
    expect(row.linkedStaffId).toBe(STAFF_ID);
    expect(row.kind).toBe("broken_link");
  });
  it("staff-<uuid>@internal.invalid ohne app_metadata → aus E-Mail, broken_link", () => {
    const [row] = pickOrphanAccounts(
      [{ id: "u1", email: `staff-${STAFF_ID}@internal.invalid` }],
      new Set(),
    );
    expect(row.linkedStaffId).toBe(STAFF_ID);
    expect(row.kind).toBe("broken_link");
  });
  it("weder noch → linkedStaffId null, kind = foreign", () => {
    const [row] = pickOrphanAccounts([{ id: "u1", email: "someone@example.com" }], new Set());
    expect(row.linkedStaffId).toBeNull();
    expect(row.kind).toBe("foreign");
  });
  it("normale staff-…@example.com wird NICHT als Schatten-Muster erkannt", () => {
    expect(readStaffIdHint({ id: "u1", email: "staff-hans@example.com" })).toBeNull();
    const [row] = pickOrphanAccounts([{ id: "u1", email: "staff-hans@example.com" }], new Set());
    expect(row.kind).toBe("foreign");
  });
});
