import { describe, expect, it } from "vitest";
import { pickOrphanAccounts, type AuthUserLike } from "./orphan-accounts";

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
    expect(row).toEqual({ userId: "x", email: null, createdAt: null, lastSignInAt: null });
    expect(row.email).toBeNull();
    expect(row.createdAt).toBeNull();
    expect(row.lastSignInAt).toBeNull();
  });
});