ALTER TABLE public.location_department_defaults
  ADD COLUMN IF NOT EXISTS default_checkin_sunday_holiday  time NULL,
  ADD COLUMN IF NOT EXISTS default_checkout_sunday_holiday time NULL;