-- E2E-G1: fehlendes GRANT auf shift_swap_requests nachversionieren.
-- RLS war aktiviert, Tabellenrechte fehlten in den Migrationen (in der
-- Produktion direkt erteilt). Muster analog shift_swap_declines.
GRANT ALL ON public.shift_swap_requests TO service_role;