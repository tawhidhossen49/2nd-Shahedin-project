-- =========================================================================
-- Shahedin — MariaDB/MySQL schema (Namecheap Stellar)
-- -------------------------------------------------------------------------
-- The same tables the Supabase (Postgres) database has, converted:
--   uuid         -> CHAR(36)
--   jsonb, text[]-> JSON
--   timestamptz  -> DATETIME(6), always stored in UTC
--   boolean      -> TINYINT(1)   (the API turns it back into true/false)
--
-- Supabase kept its users in auth.users. Here that is `users`, plus
-- `sessions` (who is logged in) and `otp_codes` (SMS login codes).
--
-- Safe to re-run: every table is CREATE TABLE IF NOT EXISTS.
-- The security rules that Supabase kept in the database (row level
-- security) live in the PHP API instead: server/api/policies.php.
-- =========================================================================

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- ---------- accounts ----------

CREATE TABLE IF NOT EXISTS users (
  id                  CHAR(36)      NOT NULL DEFAULT (UUID()),
  phone               VARCHAR(20)   NULL,        -- "8801712345678", no plus, as Supabase stored it
  email               VARCHAR(255)  NULL,
  password_hash       VARCHAR(255)  NULL,        -- bcrypt; only admins log in with a password
  google_sub          VARCHAR(64)   NULL,        -- Google's id for the person
  user_metadata       JSON          NOT NULL DEFAULT ('{}'),
  phone_confirmed_at  DATETIME(6)   NULL,
  email_confirmed_at  DATETIME(6)   NULL,
  last_sign_in_at     DATETIME(6)   NULL,
  created_at          DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at          DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY users_phone (phone),
  UNIQUE KEY users_email (email),
  UNIQUE KEY users_google (google_sub)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessions (
  token_hash    CHAR(64)     NOT NULL,           -- sha256 of the token; the token itself is never stored
  user_id       CHAR(36)     NOT NULL,
  created_at    DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  expires_at    DATETIME(6)  NOT NULL,
  last_used_at  DATETIME(6)  NULL,
  user_agent    VARCHAR(255) NULL,
  PRIMARY KEY (token_hash),
  KEY sessions_user (user_id),
  CONSTRAINT sessions_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS otp_codes (
  phone       VARCHAR(20)  NOT NULL,
  code_hash   CHAR(64)     NOT NULL,
  full_name   VARCHAR(255) NULL,
  attempts    INT          NOT NULL DEFAULT 0,
  sent_at     DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  expires_at  DATETIME(6)  NOT NULL,
  PRIMARY KEY (phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One row per OTP sent, for rate limiting (per phone and per IP).
CREATE TABLE IF NOT EXISTS otp_sends (
  id       BIGINT       NOT NULL AUTO_INCREMENT,
  phone    VARCHAR(20)  NOT NULL,
  ip       VARCHAR(45)  NOT NULL,
  sent_at  DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY otp_sends_phone (phone, sent_at),
  KEY otp_sends_ip (ip, sent_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS profiles (
  id           CHAR(36)     NOT NULL,
  phone        TEXT         NULL,
  full_name    TEXT         NULL,
  email        TEXT         NULL,
  city         TEXT         NULL,
  address      TEXT         NULL,
  institution  TEXT         NULL,
  profession   TEXT         NULL,
  bio          TEXT         NULL,
  heard_from   VARCHAR(20)  NULL,      -- sign-up question "আমাদের কোথা থেকে জানলেন?"
  created_at   DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at   DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  CONSTRAINT profiles_heard_from_chk CHECK (heard_from IS NULL OR heard_from IN ('facebook_ad','youtube','friend','other')),
  CONSTRAINT profiles_user_fk FOREIGN KEY (id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admins (
  id           CHAR(36)     NOT NULL,
  email        VARCHAR(255) NOT NULL,
  full_name    TEXT         NULL,
  role         VARCHAR(10)  NOT NULL DEFAULT 'partial',
  permissions  JSON         NOT NULL DEFAULT ('[]'),   -- was text[]: ["courses","orders",...]
  created_at   DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  CONSTRAINT admins_role_chk CHECK (role IN ('main','partial')),
  CONSTRAINT admins_user_fk FOREIGN KEY (id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Failed password logins, so guessing an admin password is slowed right down.
CREATE TABLE IF NOT EXISTS auth_failures (
  id         BIGINT       NOT NULL AUTO_INCREMENT,
  scope      VARCHAR(255) NOT NULL,       -- "ip:1.2.3.4" or "email:x@y.com"
  failed_at  DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY auth_failures_scope (scope, failed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- catalogue ----------

CREATE TABLE IF NOT EXISTS courses (
  id                   CHAR(36)      NOT NULL DEFAULT (UUID()),
  slug                 VARCHAR(191)  NOT NULL,
  title_bn             TEXT          NOT NULL,
  title_en             TEXT          NULL,
  description_bn       TEXT          NULL,
  description_en       TEXT          NULL,
  duration_bn          TEXT          NULL,
  duration_en          TEXT          NULL,
  price_bdt            INT           NOT NULL DEFAULT 0,
  old_price_bdt        INT           NULL,
  is_free              TINYINT(1)    NOT NULL DEFAULT 1,
  enrollment_open      TINYINT(1)    NOT NULL DEFAULT 1,
  enrollment_deadline  DATETIME(6)   NULL,
  thumbnail_url        TEXT          NULL,
  external_url         TEXT          NULL,
  purchase_url         TEXT          NULL,
  is_published         TINYINT(1)    NOT NULL DEFAULT 1,
  sort_order           INT           NOT NULL DEFAULT 0,
  rating               DECIMAL(3,1)  NOT NULL DEFAULT 4.8,
  students_count       INT           NOT NULL DEFAULT 0,
  tone                 INT           NOT NULL DEFAULT 1,
  category             VARCHAR(100)  NOT NULL DEFAULT 'general',
  reviews_enabled      TINYINT(1)    NOT NULL DEFAULT 1,
  show_students_count  TINYINT(1)    NOT NULL DEFAULT 1,
  learn_title          TEXT          NULL,
  learn_points         JSON          NOT NULL DEFAULT ('[]'),
  preview_video_url    TEXT          NULL,
  modules              JSON          NOT NULL DEFAULT ('[]'),
  extra                JSON          NOT NULL DEFAULT ('{}'),
  content_blocks       JSON          NOT NULL DEFAULT ('[]'),
  includes             JSON          NOT NULL DEFAULT ('[]'),
  faqs                 JSON          NOT NULL DEFAULT ('[]'),
  mentor               JSON          NOT NULL DEFAULT ('{}'),
  created_at           DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at           DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY courses_slug (slug),
  CONSTRAINT courses_rating_chk CHECK (rating >= 0 AND rating <= 5),
  CONSTRAINT courses_tone_chk CHECK (tone BETWEEN 1 AND 6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS products (
  id              CHAR(36)      NOT NULL DEFAULT (UUID()),
  slug            VARCHAR(191)  NOT NULL,
  name_bn         TEXT          NOT NULL,
  name_en         TEXT          NULL,
  description_bn  TEXT          NULL,
  description_en  TEXT          NULL,
  category        VARCHAR(100)  NOT NULL DEFAULT 'digital',
  type            VARCHAR(10)   NOT NULL DEFAULT 'digital',
  price_bdt       INT           NOT NULL DEFAULT 0,
  old_price_bdt   INT           NULL,
  stock           INT           NULL,
  image_url       TEXT          NULL,
  is_published    TINYINT(1)    NOT NULL DEFAULT 1,
  sort_order      INT           NOT NULL DEFAULT 0,
  tone            INT           NOT NULL DEFAULT 1,
  extra           JSON          NOT NULL DEFAULT ('{}'),
  delivery_type   VARCHAR(10)   NOT NULL DEFAULT 'none',
  delivery_url    TEXT          NULL,
  delivery_label  TEXT          NULL,
  delivery_note   TEXT          NULL,
  created_at      DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at      DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY products_slug (slug),
  CONSTRAINT products_tone_chk CHECK (tone BETWEEN 1 AND 6),
  CONSTRAINT products_type_chk CHECK (type IN ('digital','physical')),
  CONSTRAINT products_delivery_chk CHECK (delivery_type IN ('none','file','link'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS coupons (
  code            VARCHAR(64)   NOT NULL,
  discount_type   VARCHAR(10)   NOT NULL DEFAULT 'percent',
  discount_value  INT           NOT NULL,
  min_order_bdt   INT           NOT NULL DEFAULT 0,
  max_uses        INT           NULL,
  used_count      INT           NOT NULL DEFAULT 0,
  is_active       TINYINT(1)    NOT NULL DEFAULT 1,
  applies_to      VARCHAR(10)   NOT NULL DEFAULT 'all',
  expires_at      DATETIME(6)   NULL,
  note            TEXT          NULL,
  created_at      DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at      DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (code),
  KEY coupons_active (is_active),
  CONSTRAINT coupons_type_chk CHECK (discount_type IN ('percent','fixed')),
  CONSTRAINT coupons_value_chk CHECK (discount_value > 0),
  CONSTRAINT coupons_applies_chk CHECK (applies_to IN ('all','course','product'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- students ----------

CREATE TABLE IF NOT EXISTS enrollments (
  id                CHAR(36)     NOT NULL DEFAULT (UUID()),
  user_id           CHAR(36)     NOT NULL,
  course_id         CHAR(36)     NOT NULL,
  completed_blocks  JSON         NOT NULL DEFAULT ('[]'),
  block_progress    JSON         NOT NULL DEFAULT ('{}'),
  completed         TINYINT(1)   NOT NULL DEFAULT 0,
  completed_at      DATETIME(6)  NULL,
  enrolled_at       DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY enrollments_user_course (user_id, course_id),
  KEY enrollments_course (course_id),
  CONSTRAINT enrollments_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT enrollments_course_fk FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS course_reviews (
  id            CHAR(36)     NOT NULL DEFAULT (UUID()),
  course_id     CHAR(36)     NOT NULL,
  user_id       CHAR(36)     NOT NULL,
  student_name  TEXT         NOT NULL,
  rating        INT          NOT NULL,
  review_text   TEXT         NOT NULL,
  is_approved   TINYINT(1)   NOT NULL DEFAULT 0,
  created_at    DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at    DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY course_reviews_course_user (course_id, user_id),
  CONSTRAINT course_reviews_rating_chk CHECK (rating BETWEEN 1 AND 5),
  CONSTRAINT course_reviews_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT course_reviews_course_fk FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- money ----------

CREATE TABLE IF NOT EXISTS orders (
  id                   CHAR(36)     NOT NULL DEFAULT (UUID()),
  user_id              CHAR(36)     NOT NULL,
  kind                 VARCHAR(10)  NOT NULL,
  item_id              CHAR(36)     NOT NULL,
  item_title           TEXT         NOT NULL,
  qty                  INT          NOT NULL DEFAULT 1,
  amount_bdt           INT          NOT NULL DEFAULT 0,
  subtotal_bdt         INT          NULL,
  discount_bdt         INT          NOT NULL DEFAULT 0,
  refunded_bdt         INT          NOT NULL DEFAULT 0,
  coupon_code          VARCHAR(64)  NULL,
  payment_method       VARCHAR(32)  NULL,
  status               VARCHAR(12)  NOT NULL DEFAULT 'completed',
  buyer_name           TEXT         NULL,
  buyer_phone          TEXT         NULL,
  buyer_email          TEXT         NULL,
  shipping_address     TEXT         NULL,
  bkash_payment_id     VARCHAR(128) NULL,
  bkash_trx_id         VARCHAR(64)  NULL,
  bkash_invoice        VARCHAR(64)  NULL,
  bkash_payer_account  VARCHAR(32)  NULL,
  bkash_signature      TEXT         NULL,
  bkash_env            VARCHAR(10)  NULL,
  meta_fbp             VARCHAR(255) NULL,   -- Facebook browser id (_fbp) at checkout, for the server Purchase
  meta_fbc             VARCHAR(255) NULL,   -- Facebook ad-click id (_fbc) at checkout
  failure_reason       TEXT         NULL,
  paid_at              DATETIME(6)  NULL,
  created_at           DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY orders_bkash_payment (bkash_payment_id),   -- several NULLs are allowed
  UNIQUE KEY orders_bkash_invoice (bkash_invoice),
  KEY orders_user (user_id),
  KEY orders_status_created (status, created_at),
  CONSTRAINT orders_status_chk CHECK (status IN ('pending','completed','cancelled','failed','refunded')),
  CONSTRAINT orders_kind_chk CHECK (kind IN ('course','product')),
  CONSTRAINT orders_env_chk CHECK (bkash_env IS NULL OR bkash_env IN ('sandbox','live')),
  CONSTRAINT orders_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS order_refunds (
  id             CHAR(36)     NOT NULL DEFAULT (UUID()),
  order_id       CHAR(36)     NOT NULL,
  refund_trx_id  VARCHAR(64)  NULL,
  amount_bdt     INT          NOT NULL,
  reason         TEXT         NULL,
  sku            TEXT         NULL,
  status         VARCHAR(32)  NOT NULL DEFAULT 'Completed',
  created_by     CHAR(36)     NULL,
  created_at     DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY order_refunds_order (order_id),
  CONSTRAINT order_refunds_amount_chk CHECK (amount_bdt > 0),
  CONSTRAINT order_refunds_order_fk FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT order_refunds_by_fk FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- bKash's id_token, shared by every payment request. One row only.
CREATE TABLE IF NOT EXISTS bkash_token (
  id            SMALLINT     NOT NULL DEFAULT 1,
  id_token      TEXT         NOT NULL,
  expires_at    DATETIME(6)  NOT NULL,
  obtained_at   DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  locked_until  DATETIME(6)  NULL,
  fingerprint   TEXT         NULL,
  PRIMARY KEY (id),
  CONSTRAINT bkash_token_one_row CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bkash_api_log (
  id              BIGINT       NOT NULL AUTO_INCREMENT,
  created_at      DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  api             VARCHAR(64)  NOT NULL,
  url             TEXT         NOT NULL,
  http_status     INT          NULL,
  response_code   VARCHAR(32)  NULL,
  error_message   TEXT         NULL,
  duration_ms     INT          NULL,
  payment_id      VARCHAR(128) NULL,
  order_id        CHAR(36)     NULL,
  request_body    JSON         NULL,
  response_body   JSON         NULL,
  PRIMARY KEY (id),
  KEY bkash_api_log_created (created_at),
  KEY bkash_api_log_payment (payment_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- site content ----------

CREATE TABLE IF NOT EXISTS home_content (
  `key`       VARCHAR(100) NOT NULL,
  value       JSON         NOT NULL DEFAULT ('{}'),
  is_visible  TINYINT(1)   NOT NULL DEFAULT 1,
  updated_at  DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS site_settings (
  `key`       VARCHAR(100) NOT NULL,
  value       JSON         NOT NULL DEFAULT ('{}'),
  updated_at  DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS contact_submissions (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()),
  name            TEXT         NOT NULL,
  email           TEXT         NOT NULL,
  inquiry_type    VARCHAR(50)  NOT NULL DEFAULT 'general',
  message         TEXT         NOT NULL,
  preferred_date  TEXT         NULL,
  is_read         TINYINT(1)   NOT NULL DEFAULT 0,
  is_starred      TINYINT(1)   NOT NULL DEFAULT 0,
  admin_notes     TEXT         NULL,
  source_page     TEXT         NULL,
  created_at      DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY contact_submissions_created (created_at),
  KEY contact_submissions_read (is_read)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS page_views (
  id         BIGINT       NOT NULL AUTO_INCREMENT,
  page_path  VARCHAR(255) NOT NULL,
  referrer   TEXT         NULL,
  lang       VARCHAR(20)  NULL,
  viewed_at  DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY page_views_path (page_path),
  KEY page_views_viewed (viewed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS activity_log (
  id                BIGINT       NOT NULL AUTO_INCREMENT,
  table_name        VARCHAR(64)  NOT NULL,
  record_id         CHAR(36)     NULL,
  action            VARCHAR(10)  NOT NULL,
  changed_by        CHAR(36)     NULL,
  changed_by_email  TEXT         NULL,
  old_data          JSON         NULL,
  new_data          JSON         NULL,
  created_at        DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY activity_log_created (created_at),
  CONSTRAINT activity_log_action_chk CHECK (action IN ('insert','update','delete'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
