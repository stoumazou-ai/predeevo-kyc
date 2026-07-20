-- Batch 3 (colleague feedback 2026-07-20)
-- #14 dual nationality; #16 incorporation officers
ALTER TABLE public.kyc_shareholders ADD COLUMN IF NOT EXISTS second_nationality text;
ALTER TABLE public.kyc_applications ADD COLUMN IF NOT EXISTS directors jsonb;
ALTER TABLE public.kyc_applications ADD COLUMN IF NOT EXISTS company_secretary text;
ALTER TABLE public.kyc_applications ADD COLUMN IF NOT EXISTS registered_office text;
