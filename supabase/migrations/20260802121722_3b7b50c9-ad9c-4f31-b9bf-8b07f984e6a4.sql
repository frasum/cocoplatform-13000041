ALTER TABLE public.weather_days
  ADD COLUMN IF NOT EXISTS weather_code smallint;