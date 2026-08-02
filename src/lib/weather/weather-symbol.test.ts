import { describe, expect, it } from "vitest";
import { weatherSymbol } from "./weather-symbol";

describe("weatherSymbol", () => {
  it("klar für 0 und 1", () => {
    expect(weatherSymbol(0)).toEqual({ icon: "Sun", label: "klar" });
    expect(weatherSymbol(1)).toEqual({ icon: "Sun", label: "klar" });
  });

  it("heiter für 2, bedeckt für 3", () => {
    expect(weatherSymbol(2).icon).toBe("CloudSun");
    expect(weatherSymbol(3).icon).toBe("Cloud");
  });

  it("Nebel für 45/48", () => {
    expect(weatherSymbol(45).label).toBe("Nebel");
    expect(weatherSymbol(48).icon).toBe("CloudFog");
  });

  it("Regen: 51-57 leicht, 61-67 mäßig", () => {
    expect(weatherSymbol(53).icon).toBe("CloudDrizzle");
    expect(weatherSymbol(63).icon).toBe("CloudRain");
  });

  it("Schnee für 71-77 und 85/86", () => {
    expect(weatherSymbol(73).icon).toBe("CloudSnow");
    expect(weatherSymbol(77).icon).toBe("CloudSnow");
    expect(weatherSymbol(86).icon).toBe("CloudSnow");
  });

  it("Schauer für 80-82, Gewitter für 95-99", () => {
    expect(weatherSymbol(81).icon).toBe("CloudRainWind");
    expect(weatherSymbol(96).label).toBe("Gewitter");
  });

  it("null und unbekannte Codes ⇒ Fragezeichen ohne Label", () => {
    expect(weatherSymbol(null)).toEqual({ icon: "HelpCircle", label: "—" });
    expect(weatherSymbol(4)).toEqual({ icon: "HelpCircle", label: "—" });
    expect(weatherSymbol(120)).toEqual({ icon: "HelpCircle", label: "—" });
  });
});
