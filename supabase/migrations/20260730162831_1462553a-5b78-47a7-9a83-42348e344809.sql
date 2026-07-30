-- ST1-C4 (Abriss-Serie Alt-Skalar, Schluss): staff_compensation entfernen.
-- Seit LG3b rechnet die Payroll ausschließlich mit staff_compensation_rates;
-- ST1-A/B/C1/C2/C3 haben Statistik, Verträge, Import, SFN-Übersicht und das
-- Stammblatt-Feld umgestellt. Kein Code liest oder schreibt diese Tabelle mehr.
-- Policies, Grants und Index fallen mit der Tabelle.
DROP TABLE IF EXISTS public.staff_compensation;