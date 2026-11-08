-- =========================================================================
-- Automatic actions, the same ones the Supabase database ran as triggers.
-- Safe to re-run: each trigger is dropped and created again.
--
-- The API sets two session variables before every write, so a trigger can
-- tell who is making the change:
--   @app_user_id   the logged-in user's id (NULL when nobody is logged in)
--   @app_is_admin  1 when that user is an admin
-- =========================================================================

-- A new account gets a profile straight away (Supabase: handle_new_user).
DROP TRIGGER IF EXISTS users_after_insert;
CREATE TRIGGER users_after_insert AFTER INSERT ON users FOR EACH ROW
  INSERT IGNORE INTO profiles (id, phone, full_name)
  VALUES (NEW.id, NEW.phone, JSON_UNQUOTE(JSON_EXTRACT(NEW.user_metadata, '$.full_name')));

-- The profile follows the account's name and phone (handle_user_meta_update).
DROP TRIGGER IF EXISTS users_after_update;
CREATE TRIGGER users_after_update AFTER UPDATE ON users FOR EACH ROW
  UPDATE profiles
     SET full_name = JSON_UNQUOTE(JSON_EXTRACT(NEW.user_metadata, '$.full_name')), phone = NEW.phone
   WHERE id = NEW.id;

-- The first admin ever added is a main admin (admins_first_is_main).
DROP TRIGGER IF EXISTS admins_before_insert;
CREATE TRIGGER admins_before_insert BEFORE INSERT ON admins FOR EACH ROW
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admins WHERE role = 'main') THEN
    SET NEW.role = 'main';
  END IF;
END;

-- A course's student count follows its enrolments (sync_course_students_count).
DROP TRIGGER IF EXISTS enrollments_after_insert;
CREATE TRIGGER enrollments_after_insert AFTER INSERT ON enrollments FOR EACH ROW
  UPDATE courses SET students_count = (SELECT COUNT(*) FROM enrollments WHERE course_id = NEW.course_id)
   WHERE id = NEW.course_id;

DROP TRIGGER IF EXISTS enrollments_after_delete;
CREATE TRIGGER enrollments_after_delete AFTER DELETE ON enrollments FOR EACH ROW
  UPDATE courses SET students_count = (SELECT COUNT(*) FROM enrollments WHERE course_id = OLD.course_id)
   WHERE id = OLD.course_id;

-- A student editing their own review sends it back for approval
-- (course_reviews_reset_approval). An admin's edit keeps it as it is.
DROP TRIGGER IF EXISTS course_reviews_before_update;
CREATE TRIGGER course_reviews_before_update BEFORE UPDATE ON course_reviews FOR EACH ROW
BEGIN
  IF COALESCE(@app_is_admin, 0) <> 1 THEN
    SET NEW.is_approved = 0;
  END IF;
END;

-- Coupon use counting (bump_coupon_usage): +1 when an order becomes
-- completed, -1 when a completed order is refunded or cancelled. Skipped while
-- server/tools/import.php copies orders in (@app_import = 1): their coupons
-- arrive with used_count already counted.
DROP TRIGGER IF EXISTS orders_after_insert;
CREATE TRIGGER orders_after_insert AFTER INSERT ON orders FOR EACH ROW
BEGIN
  IF COALESCE(@app_import, 0) = 0 AND TRIM(COALESCE(NEW.coupon_code, '')) <> '' AND NEW.status = 'completed' THEN
    UPDATE coupons SET used_count = used_count + 1 WHERE code = UPPER(TRIM(NEW.coupon_code));
  END IF;
END;

DROP TRIGGER IF EXISTS orders_after_update;
CREATE TRIGGER orders_after_update AFTER UPDATE ON orders FOR EACH ROW
BEGIN
  IF COALESCE(@app_import, 0) = 0 AND TRIM(COALESCE(NEW.coupon_code, '')) <> '' THEN
    IF NEW.status = 'completed' AND NOT (OLD.status <=> 'completed') THEN
      UPDATE coupons SET used_count = used_count + 1 WHERE code = UPPER(TRIM(NEW.coupon_code));
    ELSEIF OLD.status = 'completed' AND NOT (NEW.status <=> 'completed') THEN
      UPDATE coupons SET used_count = GREATEST(0, used_count - 1) WHERE code = UPPER(TRIM(NEW.coupon_code));
    END IF;
  END IF;
END;
