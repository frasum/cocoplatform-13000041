// SD1 — Regressionsschutz: listStaff darf keine Kontaktdaten mehr
// zurückliefern. Rein statisch (Typ-Ebene), keine DB.
import { describe, it, expectTypeOf } from "vitest";
import type { listStaff } from "./staff.functions";

type StaffListRow = Awaited<ReturnType<typeof listStaff>>[number];

describe("listStaff Rückgabe-Shape (SD1)", () => {
  it("enthält keine email/phone-Felder mehr", () => {
    expectTypeOf<StaffListRow>().not.toHaveProperty("email");
    expectTypeOf<StaffListRow>().not.toHaveProperty("phone");
  });
  // SD1b — Geburts-/Eintrittsdatum dürfen im manager-lesbaren Reader nicht mehr auftauchen.
  it("enthält keine dateOfBirth/employmentStartDate-Felder (SD1b)", () => {
    expectTypeOf<StaffListRow>().not.toHaveProperty("dateOfBirth");
    expectTypeOf<StaffListRow>().not.toHaveProperty("employmentStartDate");
  });
  // SP1 — Telegram-Handle und Chat-ID sind personenbezogen und dürfen nicht
  // ins Listen-DTO wandern; nur der abgeleitete Zustand ist erlaubt.
  it("enthält weder telegramUsername noch telegramChatId (SP1)", () => {
    expectTypeOf<StaffListRow>().not.toHaveProperty("telegramUsername");
    expectTypeOf<StaffListRow>().not.toHaveProperty("telegramChatId");
  });
  it("liefert telegramState als abgeleiteten Zustand (SP1)", () => {
    expectTypeOf<StaffListRow>().toHaveProperty("telegramState");
  });
  it("liefert weiterhin Anzeigedaten für die Nicht-Personalverwaltungs-Konsumenten", () => {
    expectTypeOf<StaffListRow>().toHaveProperty("id");
    expectTypeOf<StaffListRow>().toHaveProperty("displayName");
    expectTypeOf<StaffListRow>().toHaveProperty("firstName");
    expectTypeOf<StaffListRow>().toHaveProperty("lastName");
  });
});
