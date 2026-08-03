// CH1 — Fehlergrenze: Wurf in der Karte ⇒ kompakte Fehlerdarstellung, kein
// Route-Crash. Ohne Browser prüfen wir die Boundary-Mechanik (abgeleiteter
// State) plus das gerenderte Fallback-Markup via SSR-Renderer.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CardErrorBoundary } from "./CardErrorBoundary";

describe("CardErrorBoundary (CH1)", () => {
  it("übernimmt den Fehler in den State", () => {
    const next = CardErrorBoundary.getDerivedStateFromError(
      new Error("unbekannter Kanal dfa3e9b8"),
    );
    expect(next.error?.message).toBe("unbekannter Kanal dfa3e9b8");
  });

  it("rendert Kinder, solange kein Fehler vorliegt", () => {
    const html = renderToStaticMarkup(
      <CardErrorBoundary label="test">
        <div>Karte</div>
      </CardErrorBoundary>,
    );
    expect(html).toContain("Karte");
  });

  it("rendert die Fehlerdarstellung mit Fehlertext statt der Karte", () => {
    const boundary = new CardErrorBoundary({ label: "test", children: <div>Karte</div> });
    boundary.state = { error: new Error("unbekannter Kanal dfa3e9b8") };
    const html = renderToStaticMarkup(boundary.render() as React.ReactElement);
    expect(html).toContain("Kanalzuordnung inkonsistent");
    expect(html).toContain("unbekannter Kanal dfa3e9b8");
    expect(html).not.toContain("Karte");
  });
});
