# Setting up the Shahedin Admin Panel

This connects your website to a free Supabase database, so you (or anyone you
give a login to) can add/edit/remove courses and store products, and see
website analytics — all from a web page, with zero coding.

Do these steps in order. Steps 1–5 are one-time setup (~15 minutes).

---

## 1. Create a Supabase project

1. Go to **supabase.com** → sign up (free) → **New project**.
2. Pick any name (e.g. "shahedin-website") and a strong database password
   (save it somewhere — you likely won't need it again, but keep it safe).
3. Wait ~2 minutes for the project to finish setting up.

## 2. Run the database setup script

1. In your Supabase project, open **SQL Editor** (left sidebar) → **New query**.
2. Open the file `schema.sql` from this project folder, copy **everything** in it,
   and paste it into the SQL editor.
3. Click **Run**. You should see "Success. No rows returned."
   - This creates all the tables (courses, products, analytics, etc.), sets up
     security rules so only admins can edit content, and adds a few sample
     courses so the admin panel isn't empty on first login.
   - It's safe to run again later (e.g. after an update) — it won't duplicate data.

## 3. Create your admin login

1. In Supabase, go to **Authentication → Users → Add user → Create new user**.
2. Enter the email and password you want to log into the admin panel with.
   Turn **off** "Auto confirm user" only if you want an email confirmation
   step — otherwise leave it on so you can log in immediately.
3. Click **Create user**, then copy the **User UID** shown next to your new user.
4. Go back to **SQL Editor → New query** and run (replace the values):
   ```sql
   insert into admins (id, email) values ('paste-the-user-uid-here', 'your@email.com');
   ```
5. Still in **Authentication → Settings**, turn **off** "Allow new users to sign up"
   so nobody else can create their own account. You'll add any future admins
   the same way, from Supabase's Users page + the SQL command above.

## 4. Connect the website to Supabase

**Already done in this copy** — `js/supabase-config.js` already has your project's
URL and anon key filled in. You only need to redo this if you ever create a
new/different Supabase project. Otherwise skip to Step 2 (run `schema.sql`)
and Step 3 (create your login).

1. In Supabase, go to **Settings → API**.
2. Copy the **Project URL**.
3. Copy the **anon / public** key (do **not** use the "service_role" key —
   that one must never be placed in a website file).
4. Open `js/supabase-config.js` in this project and paste both values in:
   ```js
   window.SUPABASE_URL = "https://xxxxxxxx.supabase.co";
   window.SUPABASE_ANON_KEY = "eyJhbGciOi...";
   ```
5. Save the file. That's it — both the public website and the admin panel
   read from this one file.

## 5. Log in

1. Open `admin/login.html` in your browser (once the site is deployed, this
   will be `yourdomain.com/admin/login.html`).
2. Log in with the email/password you created in Step 3.
3. You're in. From here you can add/edit courses and products, and see
   analytics — no code required.

---

## Everyday use

- **Add/edit/delete a course or product** → Admin panel → Courses / Store Products
  → the button in the top right of each list, or the pencil/trash icons on
  each row. Changes appear on the live site immediately (no rebuild/redeploy
  needed).
- **Edit any homepage text or the about-section photo** → Admin panel →
  Homepage Content. Every section of the homepage (hero, trust stats, "why
  learn," about, journey timeline, testimonials, press) is editable here,
  including adding/removing repeatable items like feature cards or
  testimonials. Save each section separately with its own "Save" button.
  The site is Bangla-only — there's no language toggle to manage.
- **Unpublish something without deleting it** → uncheck "Published" when
  editing it. It stays saved but disappears from the site.
- **Reorder items** → change the "Order" number (lower numbers show first).
- **See how the site is doing** → Admin panel → Analytics.
- **Update contact email / social links / a site banner** → Admin panel → Settings.
- **Add another admin** → repeat Step 3 above for the new person.

## Student accounts (new)

Visitors can now create their own free accounts (separate from admin logins)
by clicking "অ্যাকাউন্ট খুলুন" wherever a login prompt appears — on the
dashboard, or when they click "Enroll" on a course. Once signed up, a
student's dashboard (`dashboard.html`) shows real data pulled from Supabase:
their enrolled courses with live progress bars, a resources tab that pulls
together every "Resource link" / "PDF" block from their courses, certificates
for 100%-complete courses (viewable/printable), their order history, and an
account settings page (display name + password).

Nothing to set up here — this works automatically once `schema.sql` is run
(it adds the `enrollments` and `orders` tables). Whether a new student needs
to confirm their email before their first login depends on your
Authentication → Settings → "Confirm email" toggle in Supabase (see the
setup checklist at the bottom of `schema.sql`).

Progress tracking: content blocks a student is enrolled in get a "mark as
complete" checkbox (quizzes mark themselves complete automatically when
checked), which drives their progress bar and certificate eligibility.

## Building a course's content

Each course is built from content blocks you add in any order from the course
editor (Courses → pencil icon → "Course content"):

- **Video** — paste any YouTube URL; it's embedded right on the page.
- **Mini quiz** — add questions, each with its own answer options; mark the
  correct one per question with the radio button. Students get instant
  feedback when they click "Check answers."
- **Live class** — set a date, time, and meeting link (Zoom/Meet/etc).
- **Resource link** — any external link (a doc, a download, another site).
- **PDF** — paste a direct link to a PDF (e.g. a Google Drive file shared as
  "anyone with the link can view") and it's embedded in the page too.

Use the ↑ / ↓ buttons on each block to reorder, and ✕ to remove one. Nothing
needs to be saved individually — it's all saved together when you click
"Save changes" on the course.

## If you ever want to change *how* courses or products work

Things like "add a video URL to each course" or "add a color/size option to
products" need two small additions by a developer:
1. One line in `schema.sql` (a new column) — safe, doesn't touch existing data.
2. One new field added to the relevant form in `admin/js/admin-courses.js` or
   `admin/js/admin-products.js`, and (if it needs to show on the public
   pages) a small update to `js/render.js`.

To make this easier without a migration every time, both tables already
include a spare `extra` field (a flexible catch-all) a developer can use for
quick additions before formalizing them as a real column.

## Notes

- Until you complete Step 4, the public website keeps working using its
  original sample content, and `admin/login.html` will show a "not connected"
  message instead of a login form — nothing breaks in the meantime.
- Product/course images you upload in the admin panel are stored in
  Supabase's free file storage (created automatically by `schema.sql`).
- Analytics are cookie-free and only count page visits — no personal data,
  no third-party trackers.
