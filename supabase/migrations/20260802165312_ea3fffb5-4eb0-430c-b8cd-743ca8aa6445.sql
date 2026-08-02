-- ZT1-Sicherheitsnachzug: Die Policy "realtime_authenticated_only" auf
-- realtime.messages erlaubte JEDEM angemeldeten Konto das Lesen/Senden auf
-- BELIEBIGEN Realtime-Topics (USING (true)) — mandantenübergreifend.
-- COCO nutzt aktuell KEINE Realtime-Kanäle (kein supabase.channel(...) im
-- Code), deshalb wird die Policy entfernt statt aufgeweicht: ohne Policy ist
-- Realtime für authenticated standardmäßig gesperrt (Deny-by-default).
-- Falls später Broadcast/Presence gebraucht wird, muss eine neue Policy mit
-- realtime.topic()-Prüfung gegen current_organization_id() entstehen.
DROP POLICY IF EXISTS "realtime_authenticated_only" ON realtime.messages;