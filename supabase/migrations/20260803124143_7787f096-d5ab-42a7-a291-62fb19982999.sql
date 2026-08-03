DROP POLICY IF EXISTS lohn_absence_days_select ON public.lohn_absence_days;
DROP POLICY IF EXISTS lohn_absence_days_write ON public.lohn_absence_days;
DROP POLICY IF EXISTS lohn_recurring_zeilen_select ON public.lohn_recurring_zeilen;
DROP POLICY IF EXISTS lohn_recurring_zeilen_write ON public.lohn_recurring_zeilen;
DROP POLICY IF EXISTS prn_select_manager_or_payroll ON public.payroll_recurring_notes;

CREATE POLICY lohn_absence_days_select ON public.lohn_absence_days FOR SELECT TO authenticated
USING (organization_id = current_organization_id() AND (is_admin() OR "current_role"() = 'payroll'::app_role));

CREATE POLICY lohn_absence_days_write ON public.lohn_absence_days FOR ALL TO authenticated
USING (organization_id = current_organization_id() AND (is_admin() OR "current_role"() = 'payroll'::app_role))
WITH CHECK (organization_id = current_organization_id() AND (is_admin() OR "current_role"() = 'payroll'::app_role));

CREATE POLICY lohn_recurring_zeilen_select ON public.lohn_recurring_zeilen FOR SELECT TO authenticated
USING (organization_id = current_organization_id() AND (is_admin() OR "current_role"() = 'payroll'::app_role));

CREATE POLICY lohn_recurring_zeilen_write ON public.lohn_recurring_zeilen FOR ALL TO authenticated
USING (organization_id = current_organization_id() AND (is_admin() OR "current_role"() = 'payroll'::app_role))
WITH CHECK (organization_id = current_organization_id() AND (is_admin() OR "current_role"() = 'payroll'::app_role));

CREATE POLICY prn_select_admin_or_payroll ON public.payroll_recurring_notes FOR SELECT TO authenticated
USING (organization_id = current_organization_id() AND (is_admin() OR "current_role"() = 'payroll'::app_role));