import { describe, it, expect } from "vitest";
import { buildUebersichtCsv, type UebersichtCsvRow } from "./lohn-csv-export";
import { LohnExportBlockedError, type StaffBlocker } from "./export-blockers";

const FULL: UebersichtCsvRow = {
  persoNr: 42,
  displayName: "Müller, Anna",
  totalHours: 12.5,
  hourlyRateCents: 1500,
  night25Hours: 2.25,
  night40Hours: 0,
  sundayHours: 4,
  zuschlagCents: 1234,
  bruttoCents: 200000,
  stBruttoAusweisCent: 200000,
  lstCent: 1000,
  soliCent: 0,
  kistCent: 80,
  kvCent: 1500,
  rvCent: 1800,
  avCent: 200,
  pvCent: 300,
  nettoCents: 195120,
  auszahlungCents: 195120,
  workdayCount: 19,
  mahlzeitenCent: 8683,
  sachbezugCent: 5000,
  urlaubTage: 2,
  krankTage: 1,
  urlaubTageEst: 3,
  krankTageEst: 2,
  avgStdTag: 7.85,
  avgSfnTagCent: 1234,
  zeitlohnServiceHours: 12.5,
  zeitlohnServiceCent: 187500,
  zeitlohnGlHours: 0,
  zeitlohnGlCent: 0,
  zeitlohnKitchenHours: 0,
  zeitlohnKitchenCent: 0,
  sfnServiceCent: 1234,
  sfnGlCent: 0,
  sfnKitchenCent: 0,
  unresolvedHours: 0,
  error: null,
};

const ERR: UebersichtCsvRow = {
  persoNr: 7,
  displayName: "Schmid; Max",
  totalHours: null,
  hourlyRateCents: null,
  night25Hours: null,
  night40Hours: null,
  sundayHours: null,
  zuschlagCents: null,
  bruttoCents: null,
  stBruttoAusweisCent: null,
  lstCent: null,
  soliCent: null,
  kistCent: null,
  kvCent: null,
  rvCent: null,
  avCent: null,
  pvCent: null,
  nettoCents: null,
  auszahlungCents: null,
  workdayCount: null,
  mahlzeitenCent: null,
  sachbezugCent: null,
  urlaubTage: null,
  krankTage: null,
  urlaubTageEst: null,
  krankTageEst: null,
  avgStdTag: null,
  avgSfnTagCent: null,
  zeitlohnServiceHours: null,
  zeitlohnServiceCent: null,
  zeitlohnGlHours: null,
  zeitlohnGlCent: null,
  zeitlohnKitchenHours: null,
  zeitlohnKitchenCent: null,
  sfnServiceCent: null,
  sfnGlCent: null,
  sfnKitchenCent: null,
  unresolvedHours: null,
  error: "Keine Personaldaten für diesen Mitarbeiter.",
};

const HEADER_LINE =
  "perso_nr;name;stunden;stundensatz_cent;nacht25_std;nacht40_std;sonntag_std;zuschlag_cent;brutto_cent;st_brutto_ausweis_cent;lst_cent;soli_cent;kist_cent;kv_cent;rv_cent;av_cent;pv_cent;netto_cent;auszahlung_cent;arbeitstage;mahlzeiten_cent;sachbezug_cent;urlaub_tage;krank_tage;urlaub_tage_est;krank_tage_est;avg_std_tag;avg_sfn_tag_cent;zeitlohn_service_std;zeitlohn_service_cent;zeitlohn_gl_std;zeitlohn_gl_cent;zeitlohn_kitchen_std;zeitlohn_kitchen_cent;sfn_service_cent;sfn_gl_cent;sfn_kitchen_cent;unresolved_std;fehler";

describe("buildUebersichtCsv", () => {
  it("startet mit BOM, Kommentarzeile und exakter Header-Zeile", () => {
    const csv = buildUebersichtCsv([], { periodLabel: "Juni 2026", mode: "simple" });
    const lines = csv.split("\r\n");
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(lines[0]).toBe("\uFEFF# COCO Lohn-Übersicht; Periode=Juni 2026; Modus=simple");
    expect(lines[1]).toBe(HEADER_LINE);
  });

  it("serialisiert eine Voll-Zeile mit Ganzzahl-Cent und Dezimal-Stunden", () => {
    const csv = buildUebersichtCsv([FULL], { periodLabel: "P", mode: "simple" });
    const lines = csv.split("\r\n");
    const row = lines[2].split(";");
    expect(row).toHaveLength(39);
    expect(row[0]).toBe("42");
    expect(row[1]).toBe("Müller, Anna");
  });

  it('quotet name nur bei ;, " oder Zeilenumbruch', () => {
    const csv = buildUebersichtCsv([FULL], { periodLabel: "P", mode: "simple" });
    const row = csv.split("\r\n")[2].split(";");
    expect(row[1]).toBe("Müller, Anna");
    expect(row[2]).toBe("12.5");
    expect(row[3]).toBe("1500");
    expect(row[38]).toBe("");
  });

  it("Fehler-Zeile: Messspalten 0, name escaped wegen ;, fehler gesetzt", () => {
    const csv = buildUebersichtCsv([ERR], { periodLabel: "P", mode: "simple" });
    const line = csv.split("\r\n")[2];
    // Name enthält ";", muss in Anführungszeichen
    expect(line.startsWith('7;"Schmid; Max";')).toBe(true);
    // Messspalten jetzt "0" statt leer
    const row = line.split(";");
    // Achtung: name ist gequotet und enthält ein ";" → splittet in zwei Felder.
    // Wir prüfen daher explizit auf die Zero-Sequenz nach dem Namen.
    expect(row).not.toContain("");
    expect(line.endsWith(";Keine Personaldaten für diesen Mitarbeiter.")).toBe(true);
    // Spot-Check: viele "0"-Felder hintereinander
    expect(line).toContain(";0;0;0;0;0;0;0;0;0;0;0;0;0;0;0;0;0;0;0;0;0;0;0;0;0;0;");
  });

  it('verdoppelt " innerhalb gequoteter Felder', () => {
    const row: UebersichtCsvRow = { ...FULL, displayName: 'Say "Hi"; ok' };
    const csv = buildUebersichtCsv([row], { periodLabel: "P", mode: "simple" });
    const line = csv.split("\r\n")[2];
    expect(line).toContain('"Say ""Hi""; ok"');
  });

  it("Null-Zeile mit persoNr=null: Messspalten 0, perso_nr bleibt leer", () => {
    const csv = buildUebersichtCsv([{ ...ERR, persoNr: null, displayName: "Ohne Nummer" }], {
      periodLabel: "P",
      mode: "simple",
    });
    const row = csv.split("\r\n")[2].split(";");
    expect(row).toHaveLength(39);
    expect(row[0]).toBe(""); // perso_nr NICHT "0"
    expect(row[2]).toBe("0"); // stunden → 0
    expect(row[8]).toBe("0"); // brutto_cent → 0
    expect(row[38]).toBe("Keine Personaldaten für diesen Mitarbeiter.");
  });

  it("LG3b 2b (A7) — Lohnart-Spalten werden aus der Voll-Zeile korrekt serialisiert", () => {
    const csv = buildUebersichtCsv([FULL], { periodLabel: "P", mode: "simple" });
    const cells = csv.split("\r\n")[2].split(";");
    // Reihenfolge: 28=zeitlohn_service_std, 29=zeitlohn_service_cent,
    // 30=zeitlohn_gl_std, 31=zeitlohn_gl_cent, 32=zeitlohn_kitchen_std,
    // 33=zeitlohn_kitchen_cent, 34=sfn_service_cent, 35=sfn_gl_cent,
    // 36=sfn_kitchen_cent, 37=unresolved_std.
    expect(cells[28]).toBe("12.5");
    expect(cells[29]).toBe("187500");
    expect(cells[30]).toBe("0");
    expect(cells[31]).toBe("0");
    expect(cells[34]).toBe("1234");
    expect(cells[37]).toBe("0");
  });

  it("LG3b 2b — Gate: nicht-leere Blocker-Liste wirft LohnExportBlockedError", () => {
    const blockers: StaffBlocker[] = [
      {
        staffId: "s1",
        staffLabel: "Test",
        persoNr: null,
        reasons: [{ reason: "missing_perso_nr" }],
      },
    ];
    expect(() =>
      buildUebersichtCsv([FULL], { periodLabel: "P", mode: "simple" }, blockers),
    ).toThrow(LohnExportBlockedError);
  });
});
