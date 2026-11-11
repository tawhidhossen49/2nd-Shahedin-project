-- 2026-11: Meta Pixel / Conversions API upgrade. Safe to run once on an existing database.
ALTER TABLE profiles
  ADD COLUMN heard_from VARCHAR(20) NULL AFTER bio,
  ADD CONSTRAINT profiles_heard_from_chk CHECK (heard_from IS NULL OR heard_from IN ('facebook_ad','youtube','friend','other'));
ALTER TABLE orders
  ADD COLUMN meta_fbp VARCHAR(255) NULL AFTER bkash_env,
  ADD COLUMN meta_fbc VARCHAR(255) NULL AFTER meta_fbp;
