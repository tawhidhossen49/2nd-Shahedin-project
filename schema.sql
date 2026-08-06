-- =========================================================================
-- SHAHEDIN WEBSITE — SUPABASE SCHEMA
-- Run this whole file once in Supabase: Dashboard → SQL Editor → New query
-- → paste this file → Run. Safe to re-run (uses IF NOT EXISTS / OR REPLACE
-- where possible), but review before re-running on a live database.
-- =========================================================================

-- Needed for gen_random_uuid()
create extension if not exists pgcrypto;

-- -------------------------------------------------------------------------
-- 1. ADMINS
--    Whoever's row exists here (matched to a Supabase Auth user) can log
--    into /admin and manage courses/products. Create the Auth user first
--    (Dashboard → Authentication → Users → Add user), then insert their
--    id + email here. Do NOT let people self-register into this table.
-- -------------------------------------------------------------------------
create table if not exists admins (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  created_at timestamptz not null default now()
);

alter table admins enable row level security;

drop policy if exists "admins can read their own row" on admins;
create policy "admins can read their own row"
  on admins for select
  using (auth.uid() = id);

-- -------------------------------------------------------------------------
-- 2. COURSES
-- -------------------------------------------------------------------------
create table if not exists courses (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title_bn text not null,
  title_en text,
  description_bn text,
  description_en text,
  duration_bn text,
  duration_en text,
  price_bdt integer not null default 0,        -- 0 = free
  is_free boolean not null default true,
  thumbnail_url text,
  external_url text,                            -- where "View Course" links to, once you have real course pages
  includes jsonb not null default '[]'::jsonb,  -- "What's included" checklist shown on the buy card, e.g. [{"text":"4 weeks on-demand video"}]
  faqs jsonb not null default '[]'::jsonb,      -- per-course FAQ, e.g. [{"question":"...","answer":"..."}]
  mentor jsonb not null default '{}'::jsonb,    -- {"name":"...","bio":"...","avatar_url":"..."} shown as "Your instructor"
  is_published boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table courses enable row level security;

-- Removed: courses no longer has a public "anyone can read" policy on the
-- raw table. Paid lesson content (video links, resources, quiz questions,
-- etc.) must not be reachable by querying this table directly with the
-- public anon key — see the `courses_safe` view in section 13, which is
-- what the public site actually reads from. This line intentionally drops
-- that old policy on databases that already have it from before.
drop policy if exists "anyone can read published courses" on courses;

drop policy if exists "admins can read all courses" on courses;
create policy "admins can read all courses"
  on courses for select
  using (auth.uid() in (select id from admins));

drop policy if exists "admins can insert courses" on courses;
create policy "admins can insert courses"
  on courses for insert
  with check (auth.uid() in (select id from admins));

drop policy if exists "admins can update courses" on courses;
create policy "admins can update courses"
  on courses for update
  using (auth.uid() in (select id from admins))
  with check (auth.uid() in (select id from admins));

drop policy if exists "admins can delete courses" on courses;
create policy "admins can delete courses"
  on courses for delete
  using (auth.uid() in (select id from admins));

-- -------------------------------------------------------------------------
-- 3. PRODUCTS (resource shop)
-- -------------------------------------------------------------------------
create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name_bn text not null,
  name_en text,
  description_bn text,
  description_en text,
  category text not null default 'digital' check (category in ('pdf','book','merch','digital','physical')),
  price_bdt integer not null default 0,
  stock integer,                                 -- null = unlimited / digital good
  image_url text,
  is_published boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table products enable row level security;

drop policy if exists "anyone can read published products" on products;
create policy "anyone can read published products"
  on products for select
  using (is_published = true);

drop policy if exists "admins can read all products" on products;
create policy "admins can read all products"
  on products for select
  using (auth.uid() in (select id from admins));

drop policy if exists "admins can insert products" on products;
create policy "admins can insert products"
  on products for insert
  with check (auth.uid() in (select id from admins));

drop policy if exists "admins can update products" on products;
create policy "admins can update products"
  on products for update
  using (auth.uid() in (select id from admins))
  with check (auth.uid() in (select id from admins));

drop policy if exists "admins can delete products" on products;
create policy "admins can delete products"
  on products for delete
  using (auth.uid() in (select id from admins));

-- -------------------------------------------------------------------------
-- 4. PAGE VIEWS (lightweight analytics — no cookies, no third party)
-- -------------------------------------------------------------------------
create table if not exists page_views (
  id bigint generated always as identity primary key,
  page_path text not null,
  referrer text,
  lang text,
  viewed_at timestamptz not null default now()
);

alter table page_views enable row level security;

drop policy if exists "anyone can record a page view" on page_views;
create policy "anyone can record a page view"
  on page_views for insert
  with check (true);

drop policy if exists "admins can read page views" on page_views;
create policy "admins can read page views"
  on page_views for select
  using (auth.uid() in (select id from admins));

-- Helpful index for the analytics dashboard's date-range queries
create index if not exists page_views_viewed_at_idx on page_views (viewed_at desc);
create index if not exists page_views_page_path_idx on page_views (page_path);

-- -------------------------------------------------------------------------
-- 5. ACTIVITY LOG (automatic audit trail for courses & products)
--    A trigger writes here on every insert/update/delete — the admin
--    panel can't forget to log something because it never writes this
--    table directly.
-- -------------------------------------------------------------------------
create table if not exists activity_log (
  id bigint generated always as identity primary key,
  table_name text not null,
  record_id uuid,
  action text not null check (action in ('insert','update','delete')),
  changed_by uuid,
  changed_by_email text,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

alter table activity_log enable row level security;

drop policy if exists "admins can read activity log" on activity_log;
create policy "admins can read activity log"
  on activity_log for select
  using (auth.uid() in (select id from admins));

-- security definer so the trigger can write here even though the calling
-- admin user has no direct insert policy on activity_log (intentional —
-- nobody should be able to write fake log entries by hand)
create or replace function log_activity() returns trigger
language plpgsql security definer as $$
declare
  actor_email text;
begin
  select email into actor_email from auth.users where id = auth.uid();

  insert into activity_log (table_name, record_id, action, changed_by, changed_by_email, old_data, new_data)
  values (
    tg_table_name,
    coalesce(new.id, old.id),
    lower(tg_op),
    auth.uid(),
    actor_email,
    case when tg_op in ('update','delete') then to_jsonb(old) else null end,
    case when tg_op in ('insert','update') then to_jsonb(new) else null end
  );

  return coalesce(new, old);
end;
$$;

drop trigger if exists courses_activity_log on courses;
create trigger courses_activity_log
  after insert or update or delete on courses
  for each row execute function log_activity();

drop trigger if exists products_activity_log on products;
create trigger products_activity_log
  after insert or update or delete on products
  for each row execute function log_activity();

-- -------------------------------------------------------------------------
-- 6. keep updated_at current on edit
-- -------------------------------------------------------------------------
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists courses_set_updated_at on courses;
create trigger courses_set_updated_at
  before update on courses
  for each row execute function set_updated_at();

drop trigger if exists products_set_updated_at on products;
create trigger products_set_updated_at
  before update on products
  for each row execute function set_updated_at();

-- -------------------------------------------------------------------------
-- 7. Seed data (optional) — mirrors the sample cards already on the site
--    so the admin panel isn't empty on first login. Safe to delete these
--    rows from the admin panel once you add real content.
-- -------------------------------------------------------------------------
insert into courses (slug, title_bn, title_en, duration_bn, duration_en, price_bdt, is_free, sort_order)
values
  ('geopolitics-101', 'জিওপলিটিক্স ১০১: বিশ্ব রাজনীতি বোঝা', 'Geopolitics 101: Understanding World Politics', '৬ সপ্তাহ', '6 weeks', 0, true, 1),
  ('bangladesh-political-history', 'বাংলাদেশের রাজনৈতিক ইতিহাস', 'Political History of Bangladesh', '৪ সপ্তাহ', '4 weeks', 1499, false, 2),
  ('research-fact-checking', 'রিসার্চ ও ফ্যাক্ট-চেকিং শেখা', 'Research & Fact-Checking Skills', '৫ সপ্তাহ', '5 weeks', 2999, false, 3)
on conflict (slug) do nothing;

-- =========================================================================
-- 8. ADMIN PANEL EXTENSIONS
--    Additive columns so the admin panel can fully control what the site
--    already shows (star rating, student count, thumbnail colour, curriculum,
--    sale price, etc). All use ADD COLUMN IF NOT EXISTS so this whole file
--    stays safe to re-run on a database that already has data in it.
-- -------------------------------------------------------------------------
alter table courses add column if not exists rating numeric(2,1) not null default 4.8 check (rating between 0 and 5);
alter table courses add column if not exists students_count integer not null default 0;
alter table courses add column if not exists tone integer not null default 1 check (tone between 1 and 6); -- picks the thumbnail colour theme (1-6) already defined in css/style.css
alter table courses add column if not exists category text not null default 'general'; -- free text, used for the filter tabs on courses.html (e.g. politics, skills, economy, exam)
alter table courses add column if not exists modules jsonb not null default '[]'::jsonb; -- legacy curriculum field, superseded by content_blocks below, kept harmlessly for backward compatibility
alter table courses add column if not exists content_blocks jsonb not null default '[]'::jsonb; -- the actual course content, in display order. Each item: { id, type, title, ...type fields }
  -- type: "video"      → { youtube_url }
  -- type: "quiz"       → { questions: [{ question, options: [...], correct_index }] }
  -- type: "live_class" → { date: "YYYY-MM-DD", time: "HH:MM", meeting_link }
  -- type: "resource"   → { url }
  -- type: "pdf"        → { pdf_url }
  -- Managed entirely from the admin panel's course editor — add/edit/reorder/remove any time, no code changes needed.
alter table courses add column if not exists extra jsonb not null default '{}'::jsonb; -- catch-all for any future field the admin panel adds without needing a new migration
alter table courses add column if not exists includes jsonb not null default '[]'::jsonb; -- "What's included" checklist on the buy card, e.g. [{"text":"4 weeks on-demand video"}]
alter table courses add column if not exists faqs jsonb not null default '[]'::jsonb; -- per-course FAQ, e.g. [{"question":"...","answer":"..."}], any number of entries
alter table courses add column if not exists mentor jsonb not null default '{}'::jsonb; -- {"name":"...","bio":"...","avatar_url":"..."} shown as "Your instructor" on the course page — set per course from the admin panel, so different courses can have different mentors
alter table courses drop column if exists level; -- "levels" (beginner/intermediate/advanced) have been removed from the site entirely

-- Give every course a default mentor if it doesn't have one yet, so existing
-- courses don't suddenly show a blank instructor card.
update courses set mentor = '{
  "name": "Shahedin",
  "bio": "ইউটিউব ক্রিয়েটর ও রাজনৈতিক বিশ্লেষক, ১৮ লাখ+ সাবস্ক্রাইবার।",
  "avatar_url": "assets/img/shahedin-cutout.webp"
}'::jsonb
where mentor = '{}'::jsonb;

-- Give every course a starter "what's included" checklist if it doesn't have
-- one yet (fresh seed rows above, or older rows from before this feature).
update courses set includes = '[
  {"text": "অন-ডিমান্ড ভিডিও"},
  {"text": "ডাউনলোডযোগ্য রিসোর্স ও নোট"},
  {"text": "সম্পন্নতার সার্টিফিকেট"},
  {"text": "বাংলা সাপোর্ট"},
  {"text": "bKash-এ পেমেন্ট গ্রহণযোগ্য"}
]'::jsonb
where includes = '[]'::jsonb;

alter table products add column if not exists old_price_bdt integer; -- set this to show a "Sale" badge + strikethrough price; leave blank for no discount
alter table products add column if not exists tone integer not null default 1 check (tone between 1 and 6);
alter table products add column if not exists type text not null default 'digital' check (type in ('digital','physical')); -- controls the "Digital"/"Physical" badge + shipping note
alter table products add column if not exists extra jsonb not null default '{}'::jsonb;

-- The original "category" check on products was too strict for real use (filter
-- tabs need free text like "books"/"notes"/"merch"). Relax it if it still exists.
alter table products drop constraint if exists products_category_check;

-- -------------------------------------------------------------------------
-- 9. MEDIA STORAGE (thumbnails / product photos uploaded from the admin panel)
--    Run this once. Creates a public "media" bucket: anyone can view the
--    images (needed for the public website), only signed-in admins can
--    upload/replace/delete them.
-- -------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict (id) do nothing;

drop policy if exists "public can view media" on storage.objects;
create policy "public can view media"
  on storage.objects for select
  using (bucket_id = 'media');

drop policy if exists "admins can upload media" on storage.objects;
create policy "admins can upload media"
  on storage.objects for insert
  with check (bucket_id = 'media' and auth.uid() in (select id from admins));

drop policy if exists "admins can update media" on storage.objects;
create policy "admins can update media"
  on storage.objects for update
  using (bucket_id = 'media' and auth.uid() in (select id from admins));

drop policy if exists "admins can delete media" on storage.objects;
create policy "admins can delete media"
  on storage.objects for delete
  using (bucket_id = 'media' and auth.uid() in (select id from admins));

-- -------------------------------------------------------------------------
-- 10. SITE SETTINGS
--     Small key/value store so things like the contact email, WhatsApp
--     chat link, or a site-wide announcement can be edited from the admin
--     panel without touching code. Add new keys any time — no migration
--     needed since "value" is jsonb.
--
--     contact.whatsapp is a full WhatsApp chat link (e.g.
--     https://wa.me/8801XXXXXXXXX), not just a phone number — it's what
--     the floating support button on every page links to. Change it
--     anytime from the admin panel under Settings → Contact info.
-- -------------------------------------------------------------------------
create table if not exists site_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table site_settings enable row level security;

drop policy if exists "anyone can read site settings" on site_settings;
create policy "anyone can read site settings"
  on site_settings for select
  using (true);

drop policy if exists "admins can write site settings" on site_settings;
create policy "admins can write site settings"
  on site_settings for all
  using (auth.uid() in (select id from admins))
  with check (auth.uid() in (select id from admins));

drop trigger if exists site_settings_set_updated_at on site_settings;
create trigger site_settings_set_updated_at
  before update on site_settings
  for each row execute function set_updated_at();

insert into site_settings (key, value) values
  ('contact', '{"email":"","phone":"","whatsapp":"https://wa.me/8801XXXXXXXXX"}'::jsonb),
  ('social', '{"youtube":"","facebook":"","instagram":"","linkedin":""}'::jsonb),
  ('announcement', '{"enabled": false, "text_en": "", "text_bn": ""}'::jsonb)
on conflict (key) do nothing;

-- Existing databases: make sure contact.whatsapp holds a full chat link
-- (this only fills it in if it's currently empty, so it won't overwrite a
-- link you've already set from the admin panel).
update site_settings
set value = jsonb_set(value, '{whatsapp}', '"https://wa.me/8801XXXXXXXXX"')
where key = 'contact' and coalesce(value->>'whatsapp', '') = '';

-- -------------------------------------------------------------------------
-- 11. HOMEPAGE CONTENT
--     Every piece of text (and the about-section photo) on the homepage,
--     editable from the admin panel with zero coding. The site is Bangla-only,
--     so there's no language split here — just the live text. Seeded below
--     with the homepage's current content so the admin panel opens already
--     filled in with what's actually live.
-- -------------------------------------------------------------------------
create table if not exists home_content (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

--     is_visible: lets the admin hide a whole section from the public
--     (e.g. "hide the About section for a month") without deleting it.
--     The section stays visible to logged-in admins — see
--     js/section-visibility.js and the Section visibility panel in
--     admin/home.html.
alter table home_content add column if not exists is_visible boolean not null default true;

alter table home_content enable row level security;

drop policy if exists "anyone can read home content" on home_content;
create policy "anyone can read home content"
  on home_content for select
  using (true);

drop policy if exists "admins can write home content" on home_content;
create policy "admins can write home content"
  on home_content for all
  using (auth.uid() in (select id from admins))
  with check (auth.uid() in (select id from admins));

drop trigger if exists home_content_set_updated_at on home_content;
create trigger home_content_set_updated_at
  before update on home_content
  for each row execute function set_updated_at();

insert into home_content (key, value) values
  ('hero', '{
    "eyebrow": "ইউটিউব ক্রিয়েটর ও রাজনৈতিক বিশ্লেষক",
    "title": "পাঠ্যবইয়ের বাইরের জগতে স্বাগতম",
    "sub": "জটিল বিষয়কে বাস্তব দক্ষতায় রূপান্তর করছি — বিশ্লেষণ, শিক্ষা আর একটি ক্রমবর্ধমান কমিউনিটির মাধ্যমে।",
    "cta1": "ভিডিও দেখুন",
    "cta2": "কোর্স দেখুন",
    "cta3": "প্রোডাক্টস কিনুন",
    "image_url": ""
  }'::jsonb),
  ('stats', '{
    "subscribers_value": "1.8M", "subscribers_label": "সাবস্ক্রাইবার",
    "monthly_views_value": "12.4M", "monthly_views_label": "মাসিক ভিউ",
    "total_reach_value": "210M+", "total_reach_label": "মোট রিচ",
    "watch_hours_value": "48K", "watch_hours_label": "ওয়াচ আওয়ার",
    "rating_value": "4.9/5", "rating_label": "গড় কোর্স রেটিং",
    "students_value": "42,000+", "students_label": "নিবন্ধিত শিক্ষার্থী",
    "satisfaction_value": "96%", "satisfaction_label": "সন্তুষ্টির হার",
    "views_30d_value": "4.2M", "views_30d_label": "গত ৩০ দিনের ভিউ", "views_30d_trend": "↑ আগের মাসের তুলনায় ১৮%",
    "website_traffic_value": "680K", "website_traffic_label": "মাসিক ওয়েবসাইট ট্র্যাফিক", "website_traffic_trend": "↑ আগের মাসের তুলনায় ৯%",
    "engagement_value": "7.8%", "engagement_label": "গড় এনগেজমেন্ট হার", "engagement_trend": "ক্যাটাগরির গড়ের চেয়ে বেশি"
  }'::jsonb),
  ('why', '{
    "eyebrow": "কেন শাহেদীনের কাছে শিখবেন",
    "title": "বইয়ের তত্ত্ব নয়, বাস্তব দক্ষতা",
    "sub": "প্রতিটি লেসন তৈরি হয়েছে আজকের বাস্তবতা মাথায় রেখে — একাডেমিক নয়, প্রয়োগযোগ্য।",
    "features": [
      {"title": "বাস্তবভিত্তিক শিক্ষা", "desc": "পাঠ্যবইয়ের তত্ত্ব নয় — বাস্তব ঘটনা, বাস্তব উদাহরণ দিয়ে শেখা।"},
      {"title": "স্পষ্ট শেখার পথ", "desc": "ফ্রি ও পেইড কনটেন্ট সাজানো একটি নির্দিষ্ট কাঠামোয়, যাতে এগিয়ে যাওয়া সহজ হয়।"},
      {"title": "বিশাল দর্শকগোষ্ঠীর সমর্থন", "desc": "একটি সক্রিয় ও ব্যস্ত ইউটিউব অডিয়েন্সের ব্যাকআপ নিয়ে তৈরি।"},
      {"title": "কর্মজীবনে কাজে লাগার মতো দক্ষতা", "desc": "প্রতিটি কোর্স ডিজাইন করা হয়েছে বাস্তব জীবনে প্রয়োগের কথা ভেবে।"}
    ]
  }'::jsonb),
  ('about', '{
    "eyebrow": "গল্পটা যেভাবে শুরু",
    "title": "একজন শিক্ষক হয়ে ওঠার গল্প",
    "image_url": "",
    "paragraphs": [
      "শাহেদীন একটি ছোট্ট ঘর থেকে ফোনের ক্যামেরা আর ভূ-রাজনীতির উপর কিছু লাইব্রেরির বই নিয়ে ভিডিও বানানো শুরু করেছিলেন — কারণ তখন কেউ সংবাদকে এমনভাবে ব্যাখ্যা করছিল না যা সহজে বোঝা যায়।",
      "জোরে চিন্তা করার একটি উপায় হিসেবে শুরু হওয়া এই যাত্রা এখন এমন একটি চ্যানেলে পরিণত হয়েছে, যেখানে লাখো মানুষ সংবাদ পড়ার আগে ঘুরে আসেন। এই একই প্রবৃত্তি — জটিলতাকে স্পষ্টতায় রূপান্তর করা — এই সাইটের প্রতিটি কোর্সের ভিত্তি হয়ে উঠেছে।",
      "আজ এই কাজ বিস্তৃত হয়েছে ভিডিও প্রবন্ধ, কাঠামোবদ্ধ কোর্স এবং ব্যবহারিক, কর্মজীবনে কাজে লাগার মতো দক্ষতার একটি ক্রমবর্ধমান লাইব্রেরিতে — দ্রুত পরিবর্তনশীল বিশ্বে চলার পথ খুঁজে পেতে চাওয়া একটি দর্শকগোষ্ঠীর জন্য।"
    ],
    "timeline": [
      {"year": "২০১৮", "text": "সাইড প্রজেক্ট হিসেবে সাপ্তাহিক এক্সপ্লেইনার আপলোড শুরু"},
      {"year": "২০২০", "text": "আন্তর্জাতিক সম্পর্ক বিষয়ে স্নাতকোত্তর পড়াশোনা সম্পন্ন"},
      {"year": "২০২২", "text": "৫ লাখ সাবস্ক্রাইবার অতিক্রম, প্রথম পেইড কোর্স চালু"},
      {"year": "২০২৬", "text": "পরবর্তী প্রজন্মের জন্য একটি সম্পূর্ণ লার্নিং প্ল্যাটফর্ম তৈরি"}
    ]
  }'::jsonb),
  ('growth', '{
    "eyebrow": "যাত্রা",
    "title": "শূন্য থেকে প্রভাব তৈরির গল্প",
    "items": [
      {"mark": "২০১৮ · আইডিয়া ফেজ", "title": "একটি ক্যামেরা, একটি আইডিয়া", "desc": "একটি মাত্র আপলোড দিয়ে পরীক্ষা করা হয়েছিল মানুষ সহজভাবে ভূ-রাজনীতি বুঝতে চায় কিনা। কয়েকশ মানুষ চেয়েছিল।"},
      {"mark": "২০১৮ · প্রথম ১০০", "title": "প্রথম প্রকৃত কমিউনিটি", "desc": "প্রথম ১০০ জন সাবস্ক্রাইবার যারা মন্তব্য করেছিলেন, ভুল ধরিয়ে দিয়েছিলেন এবং আরও কনটেন্ট চেয়েছিলেন।"},
      {"mark": "২০২০ · ব্রেকথ্রু", "title": "প্রথম ভাইরাল ভিডিও", "desc": "৯০ সেকেন্ডের একটি এক্সপ্লেইনার রাতারাতি ১০ লক্ষ ভিউ অতিক্রম করে চ্যানেলের গতিপথ পাল্টে দেয়।"},
      {"mark": "২০২২ · প্রথম ১,০০০", "title": "প্রথম ১,০০০ শিক্ষার্থী", "desc": "ওয়েটলিস্টে প্রথম কোর্স চালু হয় এবং মাত্র নয় দিনে প্রথম ১,০০০ সিট বিক্রি হয়ে যায়।"},
      {"mark": "আজ", "title": "সম্পূর্ণ প্ল্যাটফর্ম তৈরি", "desc": "একটি মিডিয়া ব্র্যান্ড, একটি লার্নিং প্ল্যাটফর্ম এবং একটি স্টোর — একই দর্শকগোষ্ঠীর জন্য তৈরি একক ইকোসিস্টেম।"}
    ]
  }'::jsonb),
  ('testimonials', '{
    "eyebrow": "সামাজিক প্রমাণ",
    "title": "মানুষ যা বলছেন",
    "tab1": "শিক্ষার্থীদের মতামত",
    "tab2": "দর্শকদের প্রতিক্রিয়া",
    "students": [
      {"quote": "পলিটিক্যাল অ্যানালিস্ট কোর্সটি আমার লেখার ধরন সম্পূর্ণ পাল্টে দিয়েছে। আন্দাজের বদলে এখন আমার একটি সুনির্দিষ্ট ফ্রেমওয়ার্ক আছে।", "name": "রফিক আহমেদ", "role": "অ্যানালিস্ট টুলকিট, ২০২৫ সালে সমাপ্ত"},
      {"quote": "বিসিএস কোর্সের উত্তর টেমপ্লেট ব্যবহার করে প্রথম চেষ্টাতেই লিখিত পরীক্ষায় পাস করেছি। প্রতিটি টাকা উশুল।", "name": "নুসরাত জাহান", "role": "এক্সাম প্রেপ ট্র্যাক"},
      {"quote": "অবশেষে এমন একটি কোর্স পেলাম যা অর্থনীতিকে মুখস্থ করার বিষয় নয়, বরং সত্যিই বোঝার বিষয় হিসেবে উপস্থাপন করে।", "name": "শাকিল হোসেন", "role": "ইকোনমি এক্সপ্লেইনড"}
    ],
    "audience": [
      {"quote": "কফি শেষ করার আগেই ব্রেকিং নিউজ বুঝিয়ে দেওয়ার জন্য এই চ্যানেলই আমার একমাত্র ভরসার জায়গা।", "name": "@mahin.reads", "role": "ইউটিউব মন্তব্য"},
      {"quote": "৩ বছর ধরে দেখছি। প্রতিদিন সংবাদ পড়ার ধরনটাই একদম পাল্টে দিয়েছে।", "name": "@tania_speaks", "role": "ইউটিউব মন্তব্য"},
      {"quote": "পুরো পরিবারের গ্রুপ চ্যাটে এই চ্যানেল শেয়ার করেছি। এখন প্রতি শুক্রবার একসাথে দেখি।", "name": "@arif.bd", "role": "ইনস্টাগ্রাম মন্তব্য"}
    ]
  }'::jsonb),
  ('press', '{
    "eyebrow": "মিডিয়া",
    "title": "প্রেস এবং উপস্থিতি",
    "items": [
      {"name": "দ্য ডেইলি অ্যানালিস্ট", "caption": "ফিচার সাক্ষাৎকার, ২০২৫"},
      {"name": "পলিসি আওয়ার পডকাস্ট", "caption": "গেস্ট এপিসোড, ২০২৪"},
      {"name": "চ্যানেল ৯ নিউজ", "caption": "টিভি প্যানেল উপস্থিতি, ২০২৪"},
      {"name": "ঢাকা বিশ্ববিদ্যালয়", "caption": "অতিথি লেকচার, আন্তর্জাতিক সম্পর্ক বিভাগ"}
    ]
  }'::jsonb),
  ('portfolio', '{
    "eyebrow": "মিডিয়া কিট",
    "title": "শাহেদীনের সাথে পার্টনারশিপ করুন",
    "sub": "একটি নিবেদিত, উচ্চ-বিশ্বাসযোগ্য দর্শকগোষ্ঠীর কাছে পৌঁছান।",
    "cta1": "মিডিয়া কিট ডাউনলোড করুন (PDF)",
    "cta2": "চলুন একসাথে কাজ করি",
    "glance_title": "এক নজরে পারফরম্যান্স",
    "total_reach_trend": "↑ ২০১৮ থেকে ধারাবাহিক প্রবৃদ্ধি",
    "campaigns_title": "পূর্ববর্তী ক্যাম্পেইনের পারফরম্যান্স",
    "campaign_note": "প্রতি স্পনসরড ক্যাম্পেইনে রিচ, সর্বশেষ ৫টি ব্র্যান্ড পার্টনারশিপ · গড় CTR ৩.৮% · গড় কনভার্সন হার ৬.১%",
    "campaigns": [
      {"value": "2.1M", "height": "55"},
      {"value": "3.4M", "height": "72"},
      {"value": "1.9M", "height": "48"},
      {"value": "4.6M", "height": "88"},
      {"value": "3.0M", "height": "65"}
    ],
    "audience_title": "দর্শক সম্পর্কিত তথ্য",
    "audience_age": [
      {"label": "18–24", "percent": "34"},
      {"label": "25–34", "percent": "41"},
      {"label": "35–44", "percent": "17"},
      {"label": "45+", "percent": "8"}
    ],
    "top_locations": "শীর্ষ অবস্থান: বাংলাদেশ (৭৮%), ভারত (৭%), যুক্তরাজ্য (৪%), যুক্তরাষ্ট্র (৩%), অন্যান্য (৮%)",
    "top_interests": "শীর্ষ আগ্রহ: রাজনীতি ও সাম্প্রতিক ঘটনা, ক্যারিয়ার উন্নয়ন, অর্থনীতি, প্রতিযোগিতামূলক পরীক্ষা",
    "collaborations_title": "পূর্ববর্তী পার্টনারশিপ",
    "collaborations": [
      {"type": "স্পনসরড ভিডিও", "brand": "Brand One", "result": "2.4M", "result_label": "ভিউ, ৭ দিনে", "desc": "একটি নিবেদিত এক্সপ্লেইনার সেগমেন্ট যা প্রত্যাশার চেয়ে বেশি রিচ এনে দিয়েছে।"},
      {"type": "কোর্স কোলাবোরেশন", "brand": "Brand Two", "result": "1,200+", "result_label": "নতুন সাইনআপ", "desc": "যৌথভাবে তৈরি একটি কোর্স মডিউল, দুই সপ্তাহের প্রি-লঞ্চ ওয়েটলিস্ট সহ।"},
      {"type": "ব্র্যান্ড ইন্টিগ্রেশন", "brand": "Brand Three", "result": "6.1%", "result_label": "কনভার্সন হার", "desc": "বিদ্যমান কনটেন্ট ফরম্যাটে স্বাভাবিকভাবে মিশিয়ে দেওয়া একটি উল্লেখ।"}
    ],
    "types_title": "পার্টনারশিপের ধরন",
    "partnership_types": [
      {"title": "স্পনসরড ভিডিও", "desc": "আপনার প্রোডাক্ট নিয়ে একটি নিবেদিত ভিডিও বা ইন্টিগ্রেটেড সেগমেন্ট।"},
      {"title": "কোর্স কোলাবোরেশন", "desc": "আপনার দর্শকদের জন্য কো-ব্র্যান্ডেড বা যৌথভাবে তৈরি কোর্স কনটেন্ট।"},
      {"title": "ব্র্যান্ড ইন্টিগ্রেশন", "desc": "বিদ্যমান এক্সপ্লেইনার ফরম্যাটে স্বাভাবিকভাবে মিশিয়ে দেওয়া উল্লেখ।"},
      {"title": "অ্যাফিলিয়েট ক্যাম্পেইন", "desc": "ট্র্যাক করা অ্যাফিলিয়েট লিংকসহ পারফরম্যান্স-ভিত্তিক প্রমোশন।"}
    ],
    "cta_title": "চলুন একসাথে কাজ করি",
    "cta_sub": "ব্র্যান্ড পার্টনারশিপ, স্পনসরশিপ বা কোলাবোরেশন নিয়ে কথা বলতে চান?"
  }'::jsonb),
  ('footer', '{
    "tagline": "রাজনীতি ও দক্ষতা শিক্ষাকে সহজবোধ্য করে তোলা — একটি ভিডিও, একটি কোর্স একবারে।"
  }'::jsonb)
on conflict (key) do nothing;

-- Sections that have no editable text of their own but still need a row, so
-- the admin panel's Section visibility switches have something to write to.
insert into home_content (key, value) values
  ('trust_bar', '{}'::jsonb),
  ('videos', '{}'::jsonb),
  ('featured_courses', '{}'::jsonb),
  ('portfolio_hero', '{}'::jsonb),
  ('portfolio_glance', '{}'::jsonb),
  ('portfolio_collaborations', '{}'::jsonb),
  ('portfolio_types', '{}'::jsonb)
on conflict (key) do nothing;

-- Hero redesign (two-column hero, photo on the right): one-line title, a
-- third CTA, and an admin-swappable photo. Written as guarded updates so
-- databases seeded before the redesign pick the new fields up without
-- overwriting anything the admin has since edited.
update home_content
set value = value || jsonb_build_object(
      'title',     coalesce(nullif(value->>'title', ''), 'পাঠ্যবইয়ের বাইরের জগতে স্বাগতম'),
      'cta3',      coalesce(nullif(value->>'cta3', ''),  'প্রোডাক্টস কিনুন'),
      'image_url', coalesce(value->>'image_url', '')
    )
where key = 'hero';

update home_content
set value = jsonb_set(value, '{cta1}', '"ভিডিও দেখুন"')
where key = 'hero' and value->>'cta1' = 'ফ্রি ভিডিও দেখুন';

update home_content
set value = value || jsonb_build_object('image_url', coalesce(value->>'image_url', ''))
where key = 'portfolio';

-- =========================================================================
-- 12. STUDENT PROFILES
--     Students sign up with just a name + phone number, verified by SMS
--     OTP (see js/auth.js) — no email, no password. Supabase's own
--     `auth.users` table stores the phone and the name (as
--     raw_user_meta_data->>'full_name'), but that table lives in the
--     `auth` schema and isn't reachable through the normal REST API/RLS
--     the rest of this app uses — including from the admin panel's
--     Students page. So this `profiles` table mirrors just the bits the
--     app actually needs (name + phone), kept in sync automatically by
--     the two triggers below every time someone signs up or updates their
--     name — nothing in the app writes to `profiles` directly.
--
--     IMPORTANT — this requires phone auth to be turned on in the
--     Supabase dashboard (Authentication → Providers → Phone), with an
--     SMS provider (Twilio, MessageBird, Vonage, etc.) configured there.
--     That step can't be done from SQL.
-- -------------------------------------------------------------------------
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  phone text,
  full_name text,
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;

drop policy if exists "students can read their own profile" on profiles;
create policy "students can read their own profile"
  on profiles for select
  using (auth.uid() = id);

drop policy if exists "admins can read all profiles" on profiles;
create policy "admins can read all profiles"
  on profiles for select
  using (auth.uid() in (select id from admins));

-- Create a matching profile row the moment someone signs up.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, phone, full_name)
  values (new.id, new.phone, new.raw_user_meta_data->>'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Keep profiles.full_name current if the student updates their display
-- name later (see ShahedinAuth.updateProfile / the dashboard settings form).
create or replace function handle_user_meta_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
  set full_name = new.raw_user_meta_data->>'full_name', phone = new.phone
  where id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_updated on auth.users;
create trigger on_auth_user_updated
  after update on auth.users
  for each row execute function handle_user_meta_update();

-- Backfill profiles for any accounts that already existed before this
-- table was added (e.g. from the previous email-based sign-up system).
insert into public.profiles (id, phone, full_name)
select id, phone, raw_user_meta_data->>'full_name' from auth.users
on conflict (id) do nothing;

-- =========================================================================
-- 13. STUDENT ACCOUNTS: ENROLLMENTS & ORDERS
--     Any signed-up user is a "student" — no separate role table needed.
--     Being an admin is controlled entirely by having a row in `admins`
--     (see section 1); a student account never grants admin access.
-- -------------------------------------------------------------------------
create table if not exists enrollments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid not null references courses(id) on delete cascade,
  completed_blocks jsonb not null default '[]'::jsonb, -- array of content_block ids the student has marked done
  completed boolean not null default false,             -- true once every content block is marked done — this is what unlocks leaving a review
  completed_at timestamptz,
  enrolled_at timestamptz not null default now(),
  unique (user_id, course_id)
);

alter table enrollments add column if not exists completed boolean not null default false;
alter table enrollments add column if not exists completed_at timestamptz;

alter table enrollments enable row level security;

drop policy if exists "students can read their own enrollments" on enrollments;
create policy "students can read their own enrollments"
  on enrollments for select
  using (auth.uid() = user_id);

-- -------------------------------------------------------------------------
-- Keep courses.students_count accurate automatically. It used to be a
-- manually-typed number in the admin panel (which is why it showed 0 for
-- every course regardless of real enrollments) — now it's just a live
-- mirror of "how many rows in `enrollments` reference this course", kept
-- in sync by this trigger so nothing has to compute it on the fly.
-- -------------------------------------------------------------------------
create or replace function sync_course_students_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'INSERT') then
    update courses set students_count = (select count(*) from enrollments where course_id = new.course_id) where id = new.course_id;
  elsif (tg_op = 'DELETE') then
    update courses set students_count = (select count(*) from enrollments where course_id = old.course_id) where id = old.course_id;
  end if;
  return null;
end;
$$;

drop trigger if exists enrollments_sync_students_count on enrollments;
create trigger enrollments_sync_students_count
  after insert or delete on enrollments
  for each row execute function sync_course_students_count();

-- Fix up existing databases where students_count is stale/zero right away,
-- without waiting for the next enrollment change to trigger a recalculation.
update courses c set students_count = (select count(*) from enrollments e where e.course_id = c.id);


drop policy if exists "students can create their own enrollments" on enrollments;
create policy "students can create their own enrollments"
  on enrollments for insert
  with check (auth.uid() = user_id);

drop policy if exists "students can update their own enrollments" on enrollments;
create policy "students can update their own enrollments"
  on enrollments for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "admins can read all enrollments" on enrollments;
create policy "admins can read all enrollments"
  on enrollments for select
  using (auth.uid() in (select id from admins));

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('course', 'product')),
  item_id uuid not null, -- the course or product's id at time of purchase (no FK: keeps the order record even if the item is later deleted)
  item_title text not null,
  qty integer not null default 1,
  amount_bdt integer not null default 0, -- total for this order (price × qty)
  payment_method text,
  status text not null default 'completed' check (status in ('pending', 'completed', 'cancelled')),
  created_at timestamptz not null default now()
);

alter table orders enable row level security;

drop policy if exists "students can read their own orders" on orders;
create policy "students can read their own orders"
  on orders for select
  using (auth.uid() = user_id);

drop policy if exists "students can create their own orders" on orders;
create policy "students can create their own orders"
  on orders for insert
  with check (auth.uid() = user_id);

drop policy if exists "admins can read all orders" on orders;
create policy "admins can read all orders"
  on orders for select
  using (auth.uid() in (select id from admins));

-- =========================================================================
-- 14. COURSE REVIEWS
--     Real reviews from real students — not admin-written text. A student
--     can only submit one once they've marked every lesson in the course
--     as done (enrollments.completed = true), enforced server-side below
--     (not just hidden in the UI). The admin then chooses which reviews
--     actually show up on the course page (is_approved) — see
--     admin/reviews.html. Editing a review after it's been approved resets
--     it to pending so nothing changes on the live site without another
--     look from the admin.
-- -------------------------------------------------------------------------
create table if not exists course_reviews (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  student_name text not null,
  rating integer not null check (rating between 1 and 5),
  review_text text not null,
  is_approved boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (course_id, user_id)
);

alter table course_reviews enable row level security;

drop policy if exists "anyone can read approved reviews" on course_reviews;
create policy "anyone can read approved reviews"
  on course_reviews for select
  using (is_approved = true);

drop policy if exists "students can read their own reviews" on course_reviews;
create policy "students can read their own reviews"
  on course_reviews for select
  using (auth.uid() = user_id);

drop policy if exists "admins can read all reviews" on course_reviews;
create policy "admins can read all reviews"
  on course_reviews for select
  using (auth.uid() in (select id from admins));

drop policy if exists "students can review completed courses" on course_reviews;
create policy "students can review completed courses"
  on course_reviews for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from enrollments e
      where e.user_id = auth.uid() and e.course_id = course_reviews.course_id and e.completed = true
    )
  );

drop policy if exists "students can edit their own reviews" on course_reviews;
create policy "students can edit their own reviews"
  on course_reviews for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "students can delete their own reviews" on course_reviews;
create policy "students can delete their own reviews"
  on course_reviews for delete
  using (auth.uid() = user_id);

drop policy if exists "admins can manage all reviews" on course_reviews;
create policy "admins can manage all reviews"
  on course_reviews for all
  using (auth.uid() in (select id from admins))
  with check (auth.uid() in (select id from admins));

-- When a student edits their own review, send it back to "pending" so the
-- admin sees the new wording before it shows up on the site again. Admin
-- edits (e.g. toggling is_approved from the admin panel) are left alone.
create or replace function course_reviews_reset_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (auth.uid() in (select id from admins)) then
    new.is_approved := false;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists course_reviews_before_update on course_reviews;
create trigger course_reviews_before_update
  before update on course_reviews
  for each row execute function course_reviews_reset_approval();

-- =========================================================================
-- 15. PUBLIC-SAFE COURSE VIEW
--     The public site reads courses through this view instead of the raw
--     `courses` table (see js/data-loader.js). It looks identical to the
--     table for every column EXCEPT `content_blocks`: for a paid course,
--     if the visitor hasn't enrolled (and isn't an admin), every block is
--     stripped down to just {id, type, title, locked:true} — the actual
--     youtube_url / resource url / pdf_url / meeting_link / quiz questions
--     are never sent to the browser. This is what actually prevents
--     watching a paid video or opening a paid resource before buying —
--     hiding it with CSS on the front end wouldn't be enough, since the
--     anon API key is public and a determined visitor could otherwise just
--     query the table directly. (That's also why the previous section
--     dropped the old "anyone can read published courses" policy on the
--     raw table — non-admins now have no direct read access to it at all,
--     only through this view.)
--
--     This view intentionally runs with its owner's privileges (the
--     default for a Postgres view) rather than the caller's, so it can see
--     every row/column of `courses` in order to decide what to mask —
--     that's why the is_published / admin row-visibility check below is
--     spelled out explicitly instead of just relying on the base table's
--     RLS.
-- -------------------------------------------------------------------------
-- Dropped first (rather than relying on CREATE OR REPLACE) because Postgres
-- won't let CREATE OR REPLACE VIEW change an existing column's position —
-- only append new ones at the end — so this keeps future column additions
-- here from breaking on a re-run.
drop view if exists courses_safe;
create view courses_safe as
select
  c.id, c.slug, c.title_bn, c.title_en, c.description_bn, c.description_en,
  c.duration_bn, c.duration_en, c.price_bdt, c.is_free, c.thumbnail_url,
  c.external_url, c.is_published, c.sort_order, c.created_at, c.updated_at,
  c.rating, c.students_count, c.tone, c.category, c.modules, c.includes, c.faqs, c.mentor, c.extra,
  case
    when c.is_free then c.content_blocks
    when auth.uid() in (select id from admins) then c.content_blocks
    when auth.uid() is not null and exists (
      select 1 from enrollments e where e.user_id = auth.uid() and e.course_id = c.id
    ) then c.content_blocks
    else (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', elem->>'id', 'type', elem->>'type', 'title', elem->>'title', 'locked', true
      )), '[]'::jsonb)
      from jsonb_array_elements(c.content_blocks) elem
    )
  end as content_blocks
from courses c
where c.is_published = true or auth.uid() in (select id from admins);

grant select on courses_safe to anon, authenticated;

-- =========================================================================
-- SETUP CHECKLIST (do these in the Supabase dashboard, not in SQL):
-- 1. Authentication → Providers → make sure Email is enabled.
-- 2. Authentication → Users → Add user → create the admin's login
--    (email + password). Copy the generated User UID.
-- 3. Run:  insert into admins (id, email) values ('<paste UID>', '<email>');
-- 4. Leave Authentication → Settings → "Allow new users to sign up" ON —
--    students need this to create their own accounts. This does NOT let
--    anyone become an admin: admin access is controlled entirely by having
--    a row in the `admins` table, which only you can add via SQL (step 3).
--    A student signing up is just a normal user, nothing more.
-- 5. Authentication → Settings → check whether "Confirm email" is on. If
--    it is, students must click a confirmation link before their first
--    login; the signup form on the site already tells them to check their
--    inbox. Turn it off there if you'd rather they get instant access.
-- =========================================================================

-- =========================================================================
-- MIGRATION: shared "stats" + new "portfolio" section
-- (safe to run again on a database that was already set up before this
-- change — it only adds the two new rows if they don't already exist,
-- and only touches 'hero' if it still has the old duplicated stat fields)
-- =========================================================================
insert into home_content (key, value)
select 'stats', '{
    "subscribers_value": "1.8M", "subscribers_label": "সাবস্ক্রাইবার",
    "monthly_views_value": "12.4M", "monthly_views_label": "মাসিক ভিউ",
    "total_reach_value": "210M+", "total_reach_label": "মোট রিচ",
    "watch_hours_value": "48K", "watch_hours_label": "ওয়াচ আওয়ার",
    "rating_value": "4.9/5", "rating_label": "গড় কোর্স রেটিং",
    "students_value": "42,000+", "students_label": "নিবন্ধিত শিক্ষার্থী",
    "satisfaction_value": "96%", "satisfaction_label": "সন্তুষ্টির হার",
    "views_30d_value": "4.2M", "views_30d_label": "গত ৩০ দিনের ভিউ", "views_30d_trend": "↑ আগের মাসের তুলনায় ১৮%",
    "website_traffic_value": "680K", "website_traffic_label": "মাসিক ওয়েবসাইট ট্র্যাফিক", "website_traffic_trend": "↑ আগের মাসের তুলনায় ৯%",
    "engagement_value": "7.8%", "engagement_label": "গড় এনগেজমেন্ট হার", "engagement_trend": "ক্যাটাগরির গড়ের চেয়ে বেশি"
  }'::jsonb
where not exists (select 1 from home_content where key = 'stats');

insert into home_content (key, value)
select 'portfolio', '{
    "eyebrow": "মিডিয়া কিট",
    "title": "শাহেদীনের সাথে পার্টনারশিপ করুন",
    "sub": "একটি নিবেদিত, উচ্চ-বিশ্বাসযোগ্য দর্শকগোষ্ঠীর কাছে পৌঁছান।",
    "cta1": "মিডিয়া কিট ডাউনলোড করুন (PDF)",
    "cta2": "চলুন একসাথে কাজ করি",
    "glance_title": "এক নজরে পারফরম্যান্স",
    "total_reach_trend": "↑ ২০১৮ থেকে ধারাবাহিক প্রবৃদ্ধি",
    "campaigns_title": "পূর্ববর্তী ক্যাম্পেইনের পারফরম্যান্স",
    "campaign_note": "প্রতি স্পনসরড ক্যাম্পেইনে রিচ, সর্বশেষ ৫টি ব্র্যান্ড পার্টনারশিপ · গড় CTR ৩.৮% · গড় কনভার্সন হার ৬.১%",
    "campaigns": [
      {"value": "2.1M", "height": "55"},
      {"value": "3.4M", "height": "72"},
      {"value": "1.9M", "height": "48"},
      {"value": "4.6M", "height": "88"},
      {"value": "3.0M", "height": "65"}
    ],
    "audience_title": "দর্শক সম্পর্কিত তথ্য",
    "audience_age": [
      {"label": "18–24", "percent": "34"},
      {"label": "25–34", "percent": "41"},
      {"label": "35–44", "percent": "17"},
      {"label": "45+", "percent": "8"}
    ],
    "top_locations": "শীর্ষ অবস্থান: বাংলাদেশ (৭৮%), ভারত (৭%), যুক্তরাজ্য (৪%), যুক্তরাষ্ট্র (৩%), অন্যান্য (৮%)",
    "top_interests": "শীর্ষ আগ্রহ: রাজনীতি ও সাম্প্রতিক ঘটনা, ক্যারিয়ার উন্নয়ন, অর্থনীতি, প্রতিযোগিতামূলক পরীক্ষা",
    "collaborations_title": "পূর্ববর্তী পার্টনারশিপ",
    "collaborations": [
      {"type": "স্পনসরড ভিডিও", "brand": "Brand One", "result": "2.4M", "result_label": "ভিউ, ৭ দিনে", "desc": "একটি নিবেদিত এক্সপ্লেইনার সেগমেন্ট যা প্রত্যাশার চেয়ে বেশি রিচ এনে দিয়েছে।"},
      {"type": "কোর্স কোলাবোরেশন", "brand": "Brand Two", "result": "1,200+", "result_label": "নতুন সাইনআপ", "desc": "যৌথভাবে তৈরি একটি কোর্স মডিউল, দুই সপ্তাহের প্রি-লঞ্চ ওয়েটলিস্ট সহ।"},
      {"type": "ব্র্যান্ড ইন্টিগ্রেশন", "brand": "Brand Three", "result": "6.1%", "result_label": "কনভার্সন হার", "desc": "বিদ্যমান কনটেন্ট ফরম্যাটে স্বাভাবিকভাবে মিশিয়ে দেওয়া একটি উল্লেখ।"}
    ],
    "types_title": "পার্টনারশিপের ধরন",
    "partnership_types": [
      {"title": "স্পনসরড ভিডিও", "desc": "আপনার প্রোডাক্ট নিয়ে একটি নিবেদিত ভিডিও বা ইন্টিগ্রেটেড সেগমেন্ট।"},
      {"title": "কোর্স কোলাবোরেশন", "desc": "আপনার দর্শকদের জন্য কো-ব্র্যান্ডেড বা যৌথভাবে তৈরি কোর্স কনটেন্ট।"},
      {"title": "ব্র্যান্ড ইন্টিগ্রেশন", "desc": "বিদ্যমান এক্সপ্লেইনার ফরম্যাটে স্বাভাবিকভাবে মিশিয়ে দেওয়া উল্লেখ।"},
      {"title": "অ্যাফিলিয়েট ক্যাম্পেইন", "desc": "ট্র্যাক করা অ্যাফিলিয়েট লিংকসহ পারফরম্যান্স-ভিত্তিক প্রমোশন।"}
    ],
    "cta_title": "চলুন একসাথে কাজ করি",
    "cta_sub": "ব্র্যান্ড পার্টনারশিপ, স্পনসরশিপ বা কোলাবোরেশন নিয়ে কথা বলতে চান?"
  }'::jsonb
where not exists (select 1 from home_content where key = 'portfolio');

-- Drop the now-unused duplicated stat fields from 'hero' (harmless if
-- already absent) now that the hero stats read from 'stats' instead.
update home_content
set value = value - 'stat1_value' - 'stat1_label' - 'stat2_value' - 'stat2_label'
              - 'stat3_value' - 'stat3_label' - 'stat4_value' - 'stat4_label'
where key = 'hero';

-- The 'trust' row is no longer read by any page (the trust bar now reads
-- from 'stats'); it's left in place rather than deleted in case you want
-- to repurpose it later.


-- =========================================================================
-- MIGRATION: contact form submissions + site-wide contact/social links
-- (safe to run again on a database that was already set up before this
-- change — every statement below is idempotent)
-- =========================================================================

-- -------------------------------------------------------------------------
-- 16. CONTACT FORM SUBMISSIONS
--     Every message sent through the form on contact.html lands here, and
--     shows up in the admin panel under "Contact Messages".
--
--     Security model, deliberately one-way:
--       * anyone (logged out visitors included) may INSERT a message
--       * ONLY admins may SELECT, UPDATE or DELETE
--     So the public can write to this table but can never read anyone
--     else's messages back out of it — not even their own.
-- -------------------------------------------------------------------------
create table if not exists contact_submissions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  inquiry_type text not null default 'general',
  message text not null,
  -- Which day the visitor picked in the "book a speaking slot" calendar
  -- on contact.html, if any. Plain text so it survives any format change.
  preferred_date text,
  -- Admin workflow fields
  is_read boolean not null default false,
  is_starred boolean not null default false,
  admin_notes text,
  -- Light context, useful for spotting spam waves. No IP address is stored.
  source_page text,
  created_at timestamptz not null default now()
);

alter table contact_submissions enable row level security;

-- Public may submit a message...
drop policy if exists "anyone can submit a contact message" on contact_submissions;
create policy "anyone can submit a contact message"
  on contact_submissions for insert
  with check (true);

-- ...but only admins can ever read them back.
drop policy if exists "admins can read contact messages" on contact_submissions;
create policy "admins can read contact messages"
  on contact_submissions for select
  using (auth.uid() in (select id from admins));

drop policy if exists "admins can update contact messages" on contact_submissions;
create policy "admins can update contact messages"
  on contact_submissions for update
  using (auth.uid() in (select id from admins))
  with check (auth.uid() in (select id from admins));

drop policy if exists "admins can delete contact messages" on contact_submissions;
create policy "admins can delete contact messages"
  on contact_submissions for delete
  using (auth.uid() in (select id from admins));

-- Newest-first listing is the only sort the admin panel uses.
create index if not exists contact_submissions_created_at_idx
  on contact_submissions (created_at desc);
create index if not exists contact_submissions_is_read_idx
  on contact_submissions (is_read);

-- -------------------------------------------------------------------------
-- 17. EXTRA CONTACT / SOCIAL SETTINGS KEYS
--     The site_settings rows already existed, but the public pages now
--     actually read them (see js/site-settings.js), and a few extra fields
--     were added:
--       contact.whatsapp_label — the clickable text under "হোয়াটসঅ্যাপ"
--       contact.phone_display  — the human-readable phone shown on the page
--       social.facebook_profile — the personal profile, separate from the page
--       social.*_label          — button text for the homepage channel links
--
--     jsonb_strip_nulls + || means: keep whatever is already saved, and
--     only fill in keys that are missing. Nothing an admin has already
--     typed gets overwritten.
-- -------------------------------------------------------------------------
-- Helper: drop keys whose value is an empty string, so that the defaults
-- below can fill in genuinely blank fields. Without this, the original seed
-- (which stored email as "") would win the || merge and the field would stay
-- empty forever — because in jsonb concatenation the RIGHT side wins.
create or replace function strip_blank_settings(v jsonb) returns jsonb
language sql immutable as $$
  select coalesce(
    (select jsonb_object_agg(key, value)
     from jsonb_each(v)
     where value <> '""'::jsonb),
    '{}'::jsonb
  );
$$;

insert into site_settings (key, value) values
  ('contact', '{}'::jsonb),
  ('social',  '{}'::jsonb)
on conflict (key) do nothing;

update site_settings
set value = '{
  "email": "hello@shahedin.com",
  "phone": "https://wa.me/8801000000000",
  "phone_display": "+880 1000-000000",
  "whatsapp": "https://wa.me/8801000000000",
  "whatsapp_label": "হোয়াটসঅ্যাপে মেসেজ করুন",
  "response_time": "আমরা সাধারণত ২৪ ঘণ্টার মধ্যে উত্তর দিই।"
}'::jsonb || strip_blank_settings(value)
where key = 'contact';

update site_settings
set value = '{
  "youtube": "https://youtube.com",
  "youtube_label": "ইউটিউব চ্যানেল",
  "facebook": "https://facebook.com",
  "facebook_label": "ফেইসবুক পেইজ",
  "facebook_profile": "https://facebook.com",
  "facebook_profile_label": "ফেইসবুক প্রোফাইল",
  "instagram": "https://instagram.com",
  "linkedin": "https://linkedin.com"
}'::jsonb || strip_blank_settings(value)
where key = 'social';

-- The 'phone' key used to hold a bare number in some installs. If it isn't
-- a link, move it into phone_display and leave 'phone' for the tel:/wa.me
-- link so the page always has something sensible to show.
update site_settings
set value = jsonb_set(value, '{phone_display}', value->'phone')
where key = 'contact'
  and coalesce(value->>'phone', '') <> ''
  and value->>'phone' not like 'http%'
  and value->>'phone' not like 'tel:%'
  and coalesce(value->>'phone_display', '') = '';


-- =========================================================================
-- 17. ORDER DETAILS + COUPONS
--     Safe to re-run: every statement is IF NOT EXISTS / OR REPLACE.
--
--     Two problems this section fixes:
--
--     a) Checkout collected the buyer's name, phone, email and delivery
--        address and then threw all four away — only the item, quantity and
--        amount were saved. A physical order arrived with nowhere to ship it.
--        The columns below give those fields somewhere to live.
--
--     b) The coupon box on checkout was decorative: no table behind it, no
--        validation, no effect on the total. `coupons` + validate_coupon()
--        make it real.
-- =========================================================================

-- ---------- a) Who bought it, and where it goes -------------------------
alter table orders add column if not exists buyer_name       text;
alter table orders add column if not exists buyer_phone      text;
alter table orders add column if not exists buyer_email      text;
alter table orders add column if not exists shipping_address text;
-- What the item cost before any discount. amount_bdt stays the amount
-- actually charged, so existing rows and reports keep their meaning.
alter table orders add column if not exists subtotal_bdt     integer;
alter table orders add column if not exists coupon_code      text;
alter table orders add column if not exists discount_bdt     integer not null default 0;

-- Backfill: orders placed before this migration had no discount, so their
-- subtotal is simply what was charged.
update orders set subtotal_bdt = amount_bdt where subtotal_bdt is null;

-- ---------- b) Coupons --------------------------------------------------
create table if not exists coupons (
  code           text primary key,                    -- stored uppercase, e.g. 'EID25'
  discount_type  text not null default 'percent' check (discount_type in ('percent', 'fixed')),
  discount_value integer not null check (discount_value > 0), -- percent: 1–100. fixed: taka off.
  min_order_bdt  integer not null default 0,           -- coupon only applies at/above this subtotal
  max_uses       integer,                              -- null = unlimited
  used_count     integer not null default 0,
  is_active      boolean not null default true,
  expires_at     timestamptz,                          -- null = never expires
  note           text,                                 -- free text for the admin's own reference
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

alter table coupons add column if not exists note text;

create index if not exists coupons_active_idx on coupons (is_active) where is_active;

alter table coupons enable row level security;

-- Deliberately NO public select policy. Visitors must not be able to list
-- every code you have ever issued — they validate one code at a time through
-- the function below, which is the only way in from the public site.
drop policy if exists "admins manage coupons" on coupons;
create policy "admins manage coupons"
  on coupons for all
  using (auth.uid() in (select id from admins))
  with check (auth.uid() in (select id from admins));

drop trigger if exists coupons_set_updated_at on coupons;
create trigger coupons_set_updated_at
  before update on coupons
  for each row execute function set_updated_at();

-- ---------- Validation -------------------------------------------------
-- SECURITY DEFINER so it can read `coupons` past RLS, but it only ever
-- returns a verdict for the single code it was asked about — never a list.
-- Returns: { valid, reason, code, discount_type, discount_value, discount_bdt }
create or replace function validate_coupon(p_code text, p_subtotal integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v   coupons%rowtype;
  off integer;
begin
  if coalesce(trim(p_code), '') = '' then
    return jsonb_build_object('valid', false, 'reason', 'empty');
  end if;

  select * into v from coupons where code = upper(trim(p_code));

  if not found                                          then return jsonb_build_object('valid', false, 'reason', 'not_found');   end if;
  if not v.is_active                                    then return jsonb_build_object('valid', false, 'reason', 'inactive');    end if;
  if v.expires_at is not null and v.expires_at < now()  then return jsonb_build_object('valid', false, 'reason', 'expired');     end if;
  if v.max_uses is not null and v.used_count >= v.max_uses
                                                        then return jsonb_build_object('valid', false, 'reason', 'used_up');     end if;
  if coalesce(p_subtotal, 0) < v.min_order_bdt          then return jsonb_build_object('valid', false, 'reason', 'min_order',
                                                                                       'min_order_bdt', v.min_order_bdt);        end if;

  off := case
           when v.discount_type = 'percent' then floor(coalesce(p_subtotal, 0) * least(v.discount_value, 100) / 100.0)
           else v.discount_value
         end;
  -- Never discount below zero, and never below zero for a free item.
  off := greatest(0, least(off, coalesce(p_subtotal, 0)));

  return jsonb_build_object(
    'valid', true, 'code', v.code,
    'discount_type', v.discount_type, 'discount_value', v.discount_value,
    'discount_bdt', off
  );
end;
$$;

revoke all on function validate_coupon(text, integer) from public;
grant execute on function validate_coupon(text, integer) to anon, authenticated;

-- ---------- Usage counting ---------------------------------------------
-- Counted from the order itself rather than trusting the browser to report
-- a redemption, so the tally can't drift or be inflated by a stray call.
create or replace function bump_coupon_usage()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.coupon_code is not null and trim(new.coupon_code) <> '' then
    update coupons
       set used_count = used_count + 1
     where code = upper(trim(new.coupon_code));
  end if;
  return new;
end;
$$;

drop trigger if exists orders_bump_coupon on orders;
create trigger orders_bump_coupon
  after insert on orders
  for each row execute function bump_coupon_usage();


-- =========================================================================
-- 18. COUPON SCOPE (course-only / product-only / site-wide)
--     Safe to re-run.
--
--     Coupons were global: a code meant for a course sale also discounted
--     every book and mug in the store. `applies_to` scopes each code, and
--     validate_coupon() now refuses a code used on the wrong kind of item.
-- =========================================================================
alter table coupons add column if not exists applies_to text not null default 'all';

-- Rebuilt rather than "add if not exists" so re-running picks up any change
-- to the allowed values.
alter table coupons drop constraint if exists coupons_applies_to_check;
alter table coupons add constraint coupons_applies_to_check
  check (applies_to in ('all', 'course', 'product'));

-- Existing codes stay site-wide. Anything already issued keeps working
-- exactly as it did before this migration; scoping is opt-in per code.

-- The signature gains p_kind, so the old 2-argument version is dropped first
-- (CREATE OR REPLACE cannot change an argument list, it would just add an
-- overload and leave the unscoped version callable).
drop function if exists validate_coupon(text, integer);

create or replace function validate_coupon(p_code text, p_subtotal integer, p_kind text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v   coupons%rowtype;
  off integer;
begin
  if coalesce(trim(p_code), '') = '' then
    return jsonb_build_object('valid', false, 'reason', 'empty');
  end if;

  select * into v from coupons where code = upper(trim(p_code));

  if not found                                          then return jsonb_build_object('valid', false, 'reason', 'not_found');   end if;
  if not v.is_active                                    then return jsonb_build_object('valid', false, 'reason', 'inactive');    end if;
  if v.expires_at is not null and v.expires_at < now()  then return jsonb_build_object('valid', false, 'reason', 'expired');     end if;
  if v.max_uses is not null and v.used_count >= v.max_uses
                                                        then return jsonb_build_object('valid', false, 'reason', 'used_up');     end if;

  -- Scope check. p_kind null means the caller didn't say what is being bought,
  -- in which case only a site-wide code is accepted -- never guess in the
  -- customer's favour.
  if v.applies_to <> 'all' and v.applies_to is distinct from p_kind then
    return jsonb_build_object('valid', false, 'reason', 'wrong_scope', 'applies_to', v.applies_to);
  end if;

  if coalesce(p_subtotal, 0) < v.min_order_bdt          then return jsonb_build_object('valid', false, 'reason', 'min_order',
                                                                                       'min_order_bdt', v.min_order_bdt);        end if;

  off := case
           when v.discount_type = 'percent' then floor(coalesce(p_subtotal, 0) * least(v.discount_value, 100) / 100.0)
           else v.discount_value
         end;
  off := greatest(0, least(off, coalesce(p_subtotal, 0)));

  return jsonb_build_object(
    'valid', true, 'code', v.code, 'applies_to', v.applies_to,
    'discount_type', v.discount_type, 'discount_value', v.discount_value,
    'discount_bdt', off
  );
end;
$$;

revoke all on function validate_coupon(text, integer, text) from public;
grant execute on function validate_coupon(text, integer, text) to anon, authenticated;


-- =========================================================================
-- 19. DIGITAL PRODUCT DELIVERY
--     Safe to re-run.
--
--     Buying a digital product used to give the buyer nothing: the order was
--     recorded and that was the end of it. These columns hold what the buyer
--     actually receives, and products_safe makes sure only a buyer can read it.
--
--     THE POINT OF THE VIEW: the `products` table is world-readable
--     ("anyone can read published products" ... using is_published = true), so
--     a delivery_url sitting in a plain column would be downloadable by anyone
--     who opened the network tab, without paying. products_safe hands the URL
--     back ONLY to an admin or to someone with a completed order for that exact
--     product. Same pattern as courses_safe in section 13.
-- =========================================================================

-- 'none' = nothing to deliver (physical goods, or a digital item you fulfil
-- by hand). 'file' = something uploaded to the media bucket. 'link' = an
-- external URL (Google Drive, Notion, a private YouTube link, etc).
alter table products add column if not exists delivery_type text not null default 'none';
alter table products drop constraint if exists products_delivery_type_check;
alter table products add constraint products_delivery_type_check
  check (delivery_type in ('none', 'file', 'link'));

alter table products add column if not exists delivery_url   text;
alter table products add column if not exists delivery_label text;  -- button text, e.g. "PDF ডাউনলোড করুন"
alter table products add column if not exists delivery_note  text;  -- instructions shown after purchase only

-- -------------------------------------------------------------------------
-- products_safe: the public read path for the store.
-- delivery_type and delivery_label stay visible to everyone so the product
-- page can honestly say what you get before you buy. delivery_url and
-- delivery_note are stripped unless you have paid.
-- -------------------------------------------------------------------------
drop view if exists products_safe;
create view products_safe as
select
  p.id, p.slug, p.name_bn, p.name_en, p.description_bn, p.description_en,
  p.category, p.price_bdt, p.old_price_bdt, p.stock, p.image_url,
  p.is_published, p.sort_order, p.created_at, p.updated_at,
  p.tone, p.type, p.extra,
  p.delivery_type, p.delivery_label,
  case when p.type = 'digital' and (
         auth.uid() in (select id from admins)
         or (auth.uid() is not null and exists (
              select 1 from orders o
               where o.user_id = auth.uid()
                 and o.kind    = 'product'
                 and o.item_id = p.id
                 and o.status  = 'completed'
            ))
       )
       then p.delivery_url end as delivery_url,
  case when p.type = 'digital' and (
         auth.uid() in (select id from admins)
         or (auth.uid() is not null and exists (
              select 1 from orders o
               where o.user_id = auth.uid()
                 and o.kind    = 'product'
                 and o.item_id = p.id
                 and o.status  = 'completed'
            ))
       )
       then p.delivery_note end as delivery_note
from products p
where p.is_published = true or auth.uid() in (select id from admins);

grant select on products_safe to anon, authenticated;


-- =========================================================================
-- 20. STUDENT PROFILE DETAILS
--     Safe to re-run.
--
--     Students could only ever give a name and a phone number. These columns
--     let them fill in the rest themselves from the dashboard's Settings tab,
--     and the admin sees it under Students.
--
--     NOTE ON WRITE ACCESS: `profiles` had no student update policy at all --
--     the table is kept in sync from auth.users by the triggers in section 12
--     and nothing wrote to it directly. Two things are needed here, and both
--     matter:
--
--       1. A row policy, so a student can update their OWN row and no one
--          else's.
--       2. A COLUMN grant, so that even on their own row they can only touch
--          the self-service fields. full_name and phone are owned by
--          auth.users and mirrored down by those triggers; letting a student
--          write them directly would desync the two and would let someone
--          show the admin a phone number that is not the one they log in with.
-- =========================================================================
alter table profiles add column if not exists email       text;
alter table profiles add column if not exists city        text;
alter table profiles add column if not exists address     text;
alter table profiles add column if not exists institution text;
alter table profiles add column if not exists profession  text;
alter table profiles add column if not exists bio         text;
alter table profiles add column if not exists updated_at  timestamptz not null default now();

drop policy if exists "students can update their own profile" on profiles;
create policy "students can update their own profile"
  on profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Column-level privileges. Supabase grants blanket table access to the
-- `authenticated` role and relies on RLS for rows; RLS cannot restrict
-- COLUMNS, so this is the piece that keeps full_name, phone and id read-only
-- for students. Revoke the blanket UPDATE first, then hand back exactly the
-- six fields the Settings form owns.
revoke update on profiles from authenticated;
grant update (email, city, address, institution, profession, bio)
  on profiles to authenticated;

-- Keeps updated_at honest. A BEFORE trigger assigning NEW.updated_at does not
-- require the caller to hold an UPDATE grant on that column, so this works
-- alongside the restricted grant above.
drop trigger if exists profiles_set_updated_at on profiles;
create trigger profiles_set_updated_at
  before update on profiles
  for each row execute function set_updated_at();
