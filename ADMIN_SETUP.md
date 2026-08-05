# Setting up the Shahedin Admin Panel

This connects your website to a free Supabase database, so you (or anyone you
give a login to) can add/edit/remove courses and store products, and see
website analytics — all from a web page, with zero coding.

Do these steps in order. Steps 1–5 are one-time setup (~15 minutes).

> **Already set this up before?** Re-run `schema.sql` (Step 2) once more. The
> latest version adds the `contact_submissions` table that the contact form
> writes to, a few new Settings fields, and (section 17) the buyer-detail
> columns on `orders` plus the `coupons` table, and (section 18) coupon
> scoping so a code can be limited to courses or to store products, and
> (section 19) digital product delivery plus the `products_safe` view. Re-running
> is safe — it never duplicates data and never overwrites anything you've
> already typed into the admin panel. Until you do, the contact form won't be
> able to save messages, the coupon box on checkout won't work, and orders
> will save without the buyer's name, phone and delivery address.

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
- **Deliver a digital product** → when adding or editing a product, set Type to
  "Digital download" and then choose what the buyer receives:
  - **Upload a file** (PDF, image, zip) stored in your Supabase media bucket, or
  - **An external link** (Google Drive, Notion, a private video). Make sure it is
    shared as "anyone with the link can view".

  You can also set the button text and a short note shown only after purchase.
  The moment an order completes, the buyer sees it under **রিসোর্স** and on their
  **অর্ডার** row in the dashboard. The download link is readable *only* by
  someone who has actually bought that product, so it is safe to point at a real
  file. Leave delivery set to "Nothing automatic" for anything you fulfil by
  hand, and the product page will say so instead of promising a download.
- **See who bought what** → Admin panel → **Orders**. Every course enrolment
  and store purchase, newest first, with the name, phone, email and delivery
  address the buyer typed at checkout. Filter to "To ship" to see just the
  physical orders waiting to go out, and export the list as CSV.
- **Run a discount** → Admin panel → **Coupons**. Codes are grouped by what
  they apply to, each with its own button:
  - **Course coupons** work only when someone is buying a course.
  - **Product coupons** work only in the store.
  - **Site-wide coupons** work on both.

  For each code you set percent off or a fixed taka amount, and optionally a
  minimum order value, an expiry date and a maximum number of uses. Customers
  type it into the coupon box on checkout, and a code used on the wrong kind
  of item is refused with a message explaining which side it belongs to.
  "Turn off" stops a code working immediately while keeping its history;
  deleting it does not. Any coupon you created before scoping existed stays
  site-wide, so nothing you have already issued changes behaviour.
- **See how the site is doing** → Admin panel → Analytics.
- **Read messages from the contact form** → Admin panel → **Contact Messages**.
  Everything anyone sends through the form on `contact.html` lands here
  automatically. You can search it, star the important ones, keep private
  notes against a message, reply by email in one click, and delete messages
  one at a time, in bulk, or all at once. There's also an "Export CSV" button
  if you'd rather work through them in a spreadsheet.
- **Update contact email / phone / WhatsApp / social links / a site banner** →
  Admin panel → **Settings**. These are site-wide: the social icons in the
  footer of *every* page and the contact details on the contact page all read
  from here, so you change a link once and it updates everywhere. Clearing a
  social field removes that icon from the whole site.
- **Add another admin** → repeat Step 3 above for the new person.

## One value, every page

Two things are deliberately shared across the whole site, so you never edit
the same number or link twice:

**Stats** live in Admin panel → *Portfolio & Stats*. The homepage, the
portfolio page and the contact page all read the same values. Change the
subscriber count once and all three pages update — there is no per-page copy
to keep in sync.

**Contact details and social links** live in Admin panel → *Settings*. Every
page's footer reads the same social links, and the contact page reads the same
email, phone and WhatsApp link.

For the links you can paste whatever's easiest and the site tidies it up:

| You paste | Visitors get |
|---|---|
| `hello@shahedin.com` | a `mailto:` link |
| `+8801711223344` | a tappable `tel:` link |
| `youtube.com/@shahedin` | `https://youtube.com/@shahedin` |
| `https://wa.me/8801711223344` | used exactly as-is |

Leave a social field **empty** and that icon disappears from every page —
that's how you remove a network you no longer use.

If Supabase is ever unreachable, every page quietly falls back to the text and
links already written into the HTML, so nothing goes blank.

## Contact form messages

The form on `contact.html` writes straight into the `contact_submissions`
table. The security on that table is one-way on purpose:

- **anyone** may submit a message
- **only logged-in admins** may read, update or delete them

So visitors can write to it but nobody can read anyone else's messages back
out of it — not even their own.

If someone submits while the database is unreachable, the form tells them
honestly that it failed and keeps what they typed so they can retry. It never
shows a "sent!" message for something that didn't send.

> **Deleting is permanent.** "Clear all" asks you to type `DELETE` to confirm,
> because there's no undo and no recycle bin. Export a CSV first if you might
> want the messages later.

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
