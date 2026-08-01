// DL2 — Starter-Texte je doc_type. Werden im Vorlagen-Editor beim Anlegen
// einer NEUEN Vorlage in das Inhaltsfeld vorbefüllt. Bestehende Vorlagen
// werden davon nie berührt.

export const DEFAULT_TEMPLATE_CONTENT: Partial<Record<string, string>> = {
  abmahnung: `{{arbeitgeber_name}}
{{arbeitgeber_adresse}}

{{vorname}} {{nachname}}
{{adresse}}

{{standort}}, den {{heute}}

Abmahnung wegen unentschuldigten Fehlens

{{anrede}} {{nachname}},

am {{fehltag}} sind Sie unentschuldigt nicht zur Arbeit erschienen. Sie haben uns weder vor Arbeitsbeginn noch im Laufe des Tages über Ihr Fernbleiben oder dessen Grund informiert; auch nachträglich haben Sie Ihr Fehlen nicht erklärt.

Damit haben Sie Ihre arbeitsvertraglichen Pflichten verletzt. Sie sind verpflichtet, Ihre Arbeitsleistung zu den vereinbarten Zeiten zu erbringen und uns im Verhinderungsfall — insbesondere bei Krankheit — unverzüglich zu informieren. Ihr unentschuldigtes Fehlen hat den Betriebsablauf erheblich gestört.

Wir mahnen Sie hiermit ausdrücklich ab.

Wir fordern Sie auf, künftig Ihre Arbeitszeiten einzuhalten und uns eine Verhinderung unverzüglich mitzuteilen. Sollten Sie erneut unentschuldigt der Arbeit fernbleiben oder Ihre Anzeigepflichten verletzen, müssen Sie mit einer Kündigung Ihres Arbeitsverhältnisses rechnen.

Eine Kopie dieses Schreibens wird in Ihre Personalakte aufgenommen.

Mit freundlichen Grüßen


{{arbeitgeber_vertreter}}
{{arbeitgeber_name}}


Empfangsbestätigung

Ich bestätige, diese Abmahnung erhalten zu haben. (Die Bestätigung des Empfangs bedeutet kein Anerkenntnis der Vorwürfe.)

Ort, Datum: _______________________________


{{vorname}} {{nachname}}
`,
};
