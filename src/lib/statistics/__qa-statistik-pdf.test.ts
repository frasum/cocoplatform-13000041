import { writeFileSync } from "node:fs";
import { describe, it } from "vitest";
import { generateStatistikPdf, type StatistikPdfData } from "./statistik-pdf";
import { monthWindow } from "./statistik-pdf-charts";

describe("QA", () => {
  it("rendert eine echte Seite", async () => {
    const days = Array.from({ length: 31 }, (_, i) => ({
      businessDate: `2026-07-${String(i + 1).padStart(2, "0")}`,
      totalCents: Math.round((500_000 + Math.sin(i) * 200_000 + i * 4_000) * 1),
    }));
    const w = monthWindow(2026, 7, 13);
    const data: StatistikPdfData = {
      monthLabel: "Juli 2026",
      scopeLabel: "Alle Standorte",
      generatedAtLabel: "01.08.2026, 21:40",
      calendarMonth: true,
      revenue: {
        houseCents: 14_812_300,
        takeawayCents: 1_902_450,
        totalCents: 16_714_750,
        daysWithRevenue: 31,
      },
      previousYearTotalCents: 16_800_000,
      previousPeriodTotalCents: 15_930_000,
      takeawaySegments: [
        { name: "Wolt", amountCents: 812_300 },
        { name: "Takeaway direkt (Telefon/Abholung)", amountCents: 690_150 },
        { name: "SoUse", amountCents: 400_000 },
      ],
      takeawaySegmentsWarning: null,
      tips: {
        serviceCents: 812_340,
        kitchenCents: 214_500,
        totalCents: 1_026_840,
        perLocation: [
          {
            locationName: "Spicery",
            serviceCents: 512_340,
            kitchenCents: 134_500,
            totalCents: 646_840,
          },
          { locationName: "YUM", serviceCents: 300_000, kitchenCents: 80_000, totalCents: 380_000 },
        ],
      },
      personnel: {
        netHours: 5_464.475,
        laborCostCents: 4_812_900,
        ratioPct: 28.8,
        staffWithoutRateNames: ["GIG SERVICE"],
      },
      dailyRevenue: days,
      guestHours: {
        guestTotal: 6_431,
        workHours: 5_501.25,
        revenuePerGuestCents: 2_303,
        revenuePerWorkHourCents: 3_038,
      },
      monthly: {
        monthLabels: w.map((m) => m.label),
        series: [
          { name: "Spicery", values: w.map((_, i) => 9_000_000 + i * 120_000) },
          { name: "YUM", values: w.map((_, i) => (i === 3 ? null : 6_000_000 - i * 60_000)) },
        ],
      },
      comparison: [
        {
          locationName: "Spicery",
          totalCents: 10_412_300,
          tipTotalCents: 646_840,
          ratioPct: 27.4,
          netHours: 3_264.475,
          laborCostCents: 2_852_900,
          hasMissingRate: true,
          guestTotal: 4_120,
          perGuestCents: 2_401,
          perHourCents: 3_190,
          prevYearTotalCents: 10_530_000,
          prevTotalCents: 9_980_000,
        },
        {
          locationName: "YUM",
          totalCents: 6_302_450,
          tipTotalCents: 380_000,
          ratioPct: 31.1,
          netHours: 2_200.0,
          laborCostCents: 1_960_000,
          hasMissingRate: false,
          guestTotal: 2_311,
          perGuestCents: 2_133,
          perHourCents: 2_864,
          prevYearTotalCents: 6_270_000,
          prevTotalCents: 5_950_000,
        },
      ],
    };
    const { blob } = await generateStatistikPdf(data);
    writeFileSync("/tmp/qa/statistik.pdf", Buffer.from(await blob.arrayBuffer()));
  });
});
