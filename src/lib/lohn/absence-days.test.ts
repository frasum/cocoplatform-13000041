// UK2 — Regeltests der U/K-Tage-Erfassung.
import { describe, expect, it } from "vitest";
import {
  absenceDaysFromRow,
  assertAbsenceDaysRange,
  saveAbsenceDaysCore,
  type AbsenceDaysRow,
  type SaveAbsenceDaysDeps,
} from "./absence-days";
import { buildUrlaubKrankZeilen } from "./urlaub-krank-zeilen";

function makeDeps(existing: AbsenceDaysRow | null = null) {
  const upserts: unknown[] = [];
  const deps: SaveAbsenceDaysDeps = {
    isStaffInOrg: async () => true,
    isPeriodStart: async (p) => p === "2026-07-26",
    loadExisting: async () => existing,
    upsert: async (v) => {
      upserts.push(v);
    },
  };
  return { deps, upserts };
}

describe("UK2 — saveAbsenceDaysCore", () => {
  it("legt eine neue Zeile an und protokolliert 0/0 als Vorher-Wert", async () => {
    const { deps, upserts } = makeDeps(null);
    const out = await saveAbsenceDaysCore(deps, {
      staffId: "s1",
      periodStart: "2026-07-26",
      urlaubTage: 22,
      krankTage: 0,
    });
    expect(upserts).toHaveLength(1);
    expect(out.result).toEqual({ ok: true, urlaubTage: 22, krankTage: 0 });
    expect(out.audit.action).toBe("lohn_absence_days.upsert");
    expect(out.audit.entity).toBe("lohn_absence_days");
    expect(out.audit.meta.von).toEqual({ urlaub_tage: 0, krank_tage: 0 });
    expect(out.audit.meta.nach).toEqual({ urlaub_tage: 22, krank_tage: 0 });
  });

  it("aktualisiert eine bestehende Zeile und protokolliert alt → neu", async () => {
    const { deps } = makeDeps({ urlaub_tage: 5, krank_tage: 2 });
    const out = await saveAbsenceDaysCore(deps, {
      staffId: "s1",
      periodStart: "2026-07-26",
      urlaubTage: 0,
      krankTage: 3,
    });
    expect(out.audit.meta.von).toEqual({ urlaub_tage: 5, krank_tage: 2 });
    expect(out.audit.meta.nach).toEqual({ urlaub_tage: 0, krank_tage: 3 });
  });

  it("0/0 ist der dokumentierte Neutralzustand (kein Delete-Pfad)", async () => {
    const { deps, upserts } = makeDeps({ urlaub_tage: 4, krank_tage: 0 });
    await saveAbsenceDaysCore(deps, {
      staffId: "s1",
      periodStart: "2026-07-26",
      urlaubTage: 0,
      krankTage: 0,
    });
    expect(upserts).toEqual([
      { staffId: "s1", periodStart: "2026-07-26", urlaubTage: 0, krankTage: 0 },
    ]);
  });

  it("wirft bei Werten außerhalb 0–31 und schreibt nichts", async () => {
    const { deps, upserts } = makeDeps();
    await expect(
      saveAbsenceDaysCore(deps, {
        staffId: "s1",
        periodStart: "2026-07-26",
        urlaubTage: 32,
        krankTage: 0,
      }),
    ).rejects.toThrow(/0 und 31/);
    await expect(
      saveAbsenceDaysCore(deps, {
        staffId: "s1",
        periodStart: "2026-07-26",
        urlaubTage: 0,
        krankTage: -1,
      }),
    ).rejects.toThrow(/0 und 31/);
    expect(upserts).toHaveLength(0);
  });

  it("wirft bei nicht-ganzzahligen Tagen", () => {
    expect(() => assertAbsenceDaysRange({ urlaubTage: 1.5, krankTage: 0 })).toThrow(/ganze Tage/);
  });

  it("wirft bei einem periodStart, der kein Periodenbeginn ist", async () => {
    const { deps, upserts } = makeDeps();
    await expect(
      saveAbsenceDaysCore(deps, {
        staffId: "s1",
        periodStart: "2026-07-15",
        urlaubTage: 1,
        krankTage: 0,
      }),
    ).rejects.toThrow(/kein Beginn einer Abrechnungsperiode/);
    expect(upserts).toHaveLength(0);
  });

  it("wirft, wenn der Mitarbeiter nicht zur Organisation gehört", async () => {
    const { deps, upserts } = makeDeps();
    await expect(
      saveAbsenceDaysCore(
        { ...deps, isStaffInOrg: async () => false },
        { staffId: "fremd", periodStart: "2026-07-26", urlaubTage: 1, krankTage: 0 },
      ),
    ).rejects.toThrow(/nicht in dieser Organisation/);
    expect(upserts).toHaveLength(0);
  });
});

describe("UK2 — Neutralzustand im Rechen-Ergebnis", () => {
  it("keine Zeile ≡ Zeile mit 0/0 (bit-identische Entgeltzeilen)", () => {
    const ohneZeile = absenceDaysFromRow(null);
    const mitNull = absenceDaysFromRow({ urlaub_tage: 0, krank_tage: 0 });
    expect(ohneZeile).toEqual(mitNull);
    const args = { sollHoursPerDay: 8, hourlyRateCents: 1600, sfnTagCent: 1234 };
    expect(buildUrlaubKrankZeilen({ ...ohneZeile, ...args })).toEqual(
      buildUrlaubKrankZeilen({ ...mitNull, ...args }),
    );
    expect(buildUrlaubKrankZeilen({ ...ohneZeile, ...args })).toEqual([]);
  });
});
