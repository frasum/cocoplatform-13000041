// STAT3i — Wiederverwendbarer Test-Helfer: jsPDF zeichnet mit den
// Standardschriften (Helvetica/WinAnsi). Zeichen außerhalb von WinAnsi
// (U+2212 Minus, Δ, Gedankenstriche U+2013/2014, alles > U+00FF) haben jsPDF
// zweimal in einen Ersatzzeichen-/Sperrsatz-Modus gezwungen: der Text nach dem
// Zeichen erschien mit übergroßen Zeichenabständen („U m s a t z …").
//
// Jede neue einzeilige Wertezeile im PDF nimmt diesen Helfer mit, damit die
// Falle nicht beim nächsten Block erneut zuschnappt.

/** Namen der ausdrücklich verbotenen Zeichen (für lesbare Fehlermeldungen). */
const FORBIDDEN = new Map<string, string>([
  ["\u2212", "U+2212 MINUS SIGN (stattdessen ASCII-Bindestrich '-')"],
  ["\u0394", "U+0394 GREEK CAPITAL DELTA (stattdessen 'Delta'/'vs.')"],
  ["\u2013", "U+2013 EN DASH (stattdessen ASCII-Bindestrich '-')"],
  ["\u2014", "U+2014 EM DASH (stattdessen ASCII-Bindestrich '-')"],
]);

/**
 * Prüft einen PDF-Textbaustein auf WinAnsi-Tauglichkeit.
 *
 * Erlaubt ist alles bis U+00FF (Umlaute, ·, €-Ersatz über fmt*), verboten sind
 * die oben benannten Sonderzeichen und jedes Zeichen > U+00FF.
 * Wirft mit sprechender Meldung; im Test also einfach aufrufen.
 */
export function assertWinAnsiSafe(text: string, label = "PDF-Text"): void {
  for (const [char, why] of FORBIDDEN) {
    if (text.includes(char)) {
      throw new Error(`${label}: verbotenes Zeichen ${why} in "${text}"`);
    }
  }
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    // €-Zeichen ist in WinAnsi (0x80) enthalten und bleibt zulässig.
    if (code > 0xff && char !== "\u20ac") {
      throw new Error(
        `${label}: Zeichen "${char}" (U+${code.toString(16).toUpperCase().padStart(4, "0")}) ist nicht WinAnsi-fähig — in "${text}"`,
      );
    }
  }
}

/**
 * Grobe Breitenschätzung für Helvetica in Punkt (worst case 0.6 em je Zeichen).
 * Reicht, um zu prüfen, dass eine Zeile in die Nutzbreite passt.
 */
export function estimateHelveticaWidth(text: string, fontSize: number): number {
  return text.length * fontSize * 0.6;
}
