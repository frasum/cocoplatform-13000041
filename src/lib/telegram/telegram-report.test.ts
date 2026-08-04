import { describe, it, expect } from "vitest";
import {
  buildDailyReport,
  escapeHtml,
  fmtBerlinTime,
  DEFAULT_REPORT_FLAGS,
  type ReportInput,
  type ReportFlags,
} from "./telegram-report";

const baseLocation = {
  locationId: "loc-1",
  name: "COCO Mitte",
  hasSession: true,
  vectronCents: 152340,
  guestCount: 42,
  kontrolle: {
    fehlbetragVortagCents: -1250,
    ausgabenCents: 3499,
    tagesBargeldCents: 89012,
    differenzWechselgeldCents: 87762,
    wechselgeldbestandCents: 198750,
  },
  waiters: [
    { name: "Anna", posSalesCents: 60000, submittedAt: "2026-07-03T20:15:00+02:00" },
    { name: "Bo", posSalesCents: 45000, submittedAt: "2026-07-03T22:05:00+02:00" },
  ],
  kitchen: [
    {
      name: "Chen",
      shiftStart: "2026-07-03T15:00:00+02:00",
      shiftEnd: "2026-07-03T23:00:00+02:00",
    },
  ],
  notes: "Klimaanlage laut, Techniker Mittwoch.",
};

function makeInput(over?: Partial<ReportInput>): ReportInput {
  return {
    businessDate: "2026-07-03",
    locations: [baseLocation],
    ...over,
  };
}

describe("escapeHtml", () => {
  it("escaped & < > in dieser Reihenfolge", () => {
    expect(escapeHtml("A & B <b>x</b>")).toBe("A &amp; B &lt;b&gt;x&lt;/b&gt;");
  });
});

describe("fmtBerlinTime", () => {
  it("reine HH:MM-Uhrzeit bleibt HH:MM", () => {
    expect(fmtBerlinTime("15:00")).toBe("15:00");
  });
  it("HH:MM:SS wird auf HH:MM gekürzt", () => {
    expect(fmtBerlinTime("15:00:00")).toBe("15:00");
  });
  it("ISO mit Zeitzone → Berlin-HH:MM", () => {
    expect(fmtBerlinTime("2026-07-03T20:15:00+02:00")).toBe("20:15");
  });
  it("null → --:--", () => {
    expect(fmtBerlinTime(null)).toBe("--:--");
  });
  it("Unfug → --:--", () => {
    expect(fmtBerlinTime("nope")).toBe("--:--");
  });
});

describe("buildDailyReport — Küche mit reinen HH:MM-Strings", () => {
  it("rendert (15:00–23:30) statt (--:-- – --:--)", () => {
    const out = buildDailyReport(
      {
        businessDate: "2026-07-03",
        locations: [
          {
            locationId: "loc-x",
            name: "BÄNG",
            hasSession: true,
            kitchen: [{ name: "K", shiftStart: "15:00", shiftEnd: "23:30" }],
          },
        ],
      },
      DEFAULT_REPORT_FLAGS,
    );
    expect(out).toContain("(15:00–23:30)");
  });
});

describe("buildDailyReport — Escaping", () => {
  it("lässt <b> in Notizen als Text stehen", () => {
    const out = buildDailyReport(
      makeInput({ locations: [{ ...baseLocation, notes: "Achtung <b>heiß</b>" }] }),
      DEFAULT_REPORT_FLAGS,
    );
    expect(out).toContain("Achtung &lt;b&gt;heiß&lt;/b&gt;");
    expect(out).not.toContain("Achtung <b>heiß</b>");
  });
  it("escaped Kellnernamen mit HTML-Zeichen", () => {
    const out = buildDailyReport(
      makeInput({
        locations: [
          {
            ...baseLocation,
            waiters: [{ name: "A&B <x>", posSalesCents: 100, submittedAt: null }],
          },
        ],
      }),
      DEFAULT_REPORT_FLAGS,
    );
    expect(out).toContain("A&amp;B &lt;x&gt;");
  });
});

describe("buildDailyReport — Flags", () => {
  function withFlag(patch: Partial<ReportFlags>): string {
    return buildDailyReport(makeInput(), { ...DEFAULT_REPORT_FLAGS, ...patch });
  }

  it("umsatz=false blendet Vectron-Zeile aus", () => {
    expect(withFlag({ umsatz: false })).not.toMatch(/Vectron:/);
  });
  it("gaeste=false blendet Gäste-Zeile aus", () => {
    expect(withFlag({ gaeste: false })).not.toMatch(/Gäste:/);
  });
  it("kontrolle=false blendet den Kontrolle-Block aus", () => {
    const out = withFlag({ kontrolle: false });
    expect(out).not.toMatch(/Kontrolle/);
    expect(out).not.toMatch(/Wechselgeldbestand/);
  });
  it("kellner=false blendet den Kellner-Block aus", () => {
    expect(withFlag({ kellner: false })).not.toMatch(/Kellner/);
  });
  it("kueche=false blendet den Küchen-Block aus", () => {
    expect(withFlag({ kueche: false })).not.toMatch(/Küche/);
  });
  it("notizen=false blendet die Notiz aus", () => {
    expect(withFlag({ notizen: false })).not.toMatch(/Klimaanlage/);
  });
});

describe("buildDailyReport — excludedLocationIds", () => {
  it("filtert Standort komplett raus", () => {
    const out = buildDailyReport(makeInput(), {
      ...DEFAULT_REPORT_FLAGS,
      excludedLocationIds: ["loc-1"],
    });
    expect(out).not.toMatch(/COCO Mitte/);
  });
});

describe("buildDailyReport — Keine Daten", () => {
  it("meldet 'Keine Daten' bei hasSession=false", () => {
    const out = buildDailyReport(
      makeInput({
        locations: [
          {
            locationId: "loc-2",
            name: "Leerer Laden",
            hasSession: false,
          },
        ],
      }),
      DEFAULT_REPORT_FLAGS,
    );
    expect(out).toMatch(/Leerer Laden/);
    expect(out).toMatch(/Keine Daten/);
  });
});

describe("buildDailyReport — Snapshot (voller Standort)", () => {
  it("kanonischer Aufbau mit synthetischen Beträgen", () => {
    const out = buildDailyReport(makeInput(), DEFAULT_REPORT_FLAGS);
    expect(out).toMatchInlineSnapshot(`
"<b>Tagesbericht 03.07.2026</b>

<b>COCO Mitte</b>
Vectron: 1.523,40 €
Gäste: 42 (⌀ 36,27 €)

<b>Kontrolle</b>
• Fehlbetrag Vortag: -12,50 €
• Ausgaben: 34,99 €
• Tages-Bargeld: 890,12 €
• Differenz zum Wechselgeldbestand: 877,62 €
• Wechselgeldbestand: 1.987,50 €

<b>Kellner</b>
• Anna: 600,00 € (Abgabe 20:15)
• Bo: 450,00 € (Abgabe 22:05)

<b>Küche</b>
• Chen (15:00–23:00)

📝 Klimaanlage laut, Techniker Mittwoch."
`);
  });
});

// TG5-b — „Umsatz/Std" ist eine eigene Inhalts-Option.
describe("buildDailyReport — Flag umsatzStd (TG5-b)", () => {
  const input: ReportInput = {
    businessDate: "2026-07-03",
    locations: [
      {
        locationId: "loc-1",
        name: "COCO Mitte",
        hasSession: true,
        vectronCents: 152340,
        revenuePerWorkHourCents: 7600,
      },
    ],
  };

  it("Flag an (Default): Kennzahl hängt an der Umsatzzeile", () => {
    const out = buildDailyReport(input, DEFAULT_REPORT_FLAGS);
    expect(out).toContain("Vectron: 1.523,40 € · 76 €/Std");
  });

  it("Flag aus: Kennzahl fehlt, Umsatzzeile bleibt", () => {
    const out = buildDailyReport(input, { ...DEFAULT_REPORT_FLAGS, umsatzStd: false });
    expect(out).toContain("Vectron: 1.523,40 €");
    expect(out).not.toMatch(/€\/Std/);
  });

  it("umsatz aus, umsatzStd an: eigene kompakte Zeile", () => {
    const out = buildDailyReport(input, { ...DEFAULT_REPORT_FLAGS, umsatz: false });
    expect(out).not.toMatch(/Vectron:/);
    expect(out).toContain("Umsatz/Std: 76 €/Std");
  });

  it("beide aus: keine der beiden Zeilen", () => {
    const out = buildDailyReport(input, {
      ...DEFAULT_REPORT_FLAGS,
      umsatz: false,
      umsatzStd: false,
    });
    expect(out).not.toMatch(/Vectron:|€\/Std/);
  });
});
