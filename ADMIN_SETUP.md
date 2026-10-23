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
> (section 19) digital product delivery plus the `products_safe` view, and
> (section 20) the extra student profile fields, and (sections 28 and 29)
> everything bKash checkout needs. Re-running
> is safe — it never duplicates data and never overwrites anything you've
> already typed into the admin panel. Until you do, the contact form won't be
> able to save messages, the coupon box on checkout won't work, and orders
> will save without the buyer's name, phone and delivery address.

> **Taking payments?** The database half is sections 28 and 29 of `schema.sql`.
> The other half is deploying two small server functions and pasting in your
> bKash merchant credentials — that is a separate ten-minute job, written up in
> **DEPLOY_BKASH.md**. Until it is done, checkout cannot take money.

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
   - This creates all the tables (courses, products, analytics, etc.) and sets
     up security rules so only admins can edit content. It adds no sample
     courses or products: the site shows only what you add yourself.
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
   so nobody else can create their own account.

The first admin you add this way becomes the **main admin** automatically.
Every admin after that is added from inside the panel, on **Team & access** —
you never need this SQL command again. See "Team members and what each can
do" below.

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

- **Not sure where something is?** → the Dashboard has a "What do you want to
  do?" box for each common job. Press one and it takes you there.
- **Add/edit/delete a course or product** → Admin panel → Courses / Store products
  → the button in the top right of each list, or **Edit** / **Delete** on
  each row. Changes appear on the live site immediately (no rebuild/redeploy
  needed).
- **Edit any homepage text or the about-section photo** → Admin panel →
  Homepage. Every section of the homepage (hero, trust stats, "why
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
- **Add community links** → Admin panel → **Community**. Whatever you add here
  appears on the **কমিউনিটি** tab of every student's dashboard: a Discord
  server, a Telegram or WhatsApp group, a Facebook group, or any other link.
  Each one gets a name, the link itself, an optional one-line description, and
  a platform so it shows the right logo. Use the ↑ / ↓ buttons to control the
  order students see. You can also edit the tab's heading and intro line.

  > These links are **publicly readable** through the site's API, which is how
  > the dashboard loads them. Invite links are meant to be shared, so that is
  > normally fine, but don't put anything secret here.
- **See a student's details** → Admin panel → **Students**. Students can now
  fill in their own email, city, address, institution, profession and a short
  note from the Settings tab of their dashboard. The list shows name, contact
  and city at a glance, "View" opens the full profile, and the search box
  covers email, city, institution and profession as well as name and phone.
  Only fields the student actually answered are shown, so the panel is not a
  wall of blanks. Students can only edit their own details, and only those six
  fields; their name and phone stay tied to the login and cannot be changed
  this way.
- **See who bought what** → Admin panel → **Orders**. Every course enrolment
  and store purchase, newest first, with the name, phone, email and delivery
  address the buyer typed at checkout. Filter to "To ship" to see just the
  physical orders waiting to go out, and export the list as CSV.

  **Read the badge on each row, not just the amount.** A row appears the moment
  someone *starts* a bKash payment, so the list also contains attempts that
  never finished:

  - **Paid** — the money arrived. Only these count towards Revenue.
  - **Awaiting payment** — they went to bKash and never came back. Normal; no
    money, no access granted. It settles itself if the payment does land.
  - **Failed** / **Cancelled** — no money taken.
  - **Refunded** — you sent it all back.

  To refund a paid order, press **Refund** on its row and enter an amount. The
  money goes back through bKash straight away. You can refund part of an order
  (up to 10 times, within 60 days); a partial refund leaves the buyer's access
  in place, and refunding the full amount does not.
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
- **Edit the Terms of Service or Privacy Policy** → Admin panel → **Terms &
  Privacy**. Both public pages (`/terms.html` and `/privacy.html`) are fully
  editable here, with a live preview showing exactly how visitors will see it.
  The body box understands a few simple marks: `## Heading`, `- bullet`,
  `1. numbered`, `**bold**` and `[link text](contact.html)`. A blank line starts
  a new paragraph. "Reset to the built-in text" puts the original wording back
  if you want to start over.

  > The supplied text is a **starting point, not legal advice**. It describes
  > what this site genuinely does, but it has not been reviewed by a lawyer.
  > Get someone qualified to check it, especially the refund terms and anything
  > about personal data.
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

## Team members and what each can do

Admin panel → **Team & access**. Only a main admin sees this page.

There are two kinds of admin:

- **Main admin** — can open every page, and can add, remove and change the
  other team members. Give this only to people you fully trust: a main admin
  can remove another main admin.
- **Limited access** — can open only the pages you tick for them. Everything
  else is missing from their menu, and the database refuses it too, so it is
  not just hidden.

To add someone: **+ Add a team member** → type their email, a name, and a
password you choose for them → pick "Limited access" or "Main admin" → tick
the pages they need → **Add team member**. Tell them the password yourself;
nothing is emailed. If that email already has a login on the site, that login
is made an admin and keeps its own password.

To change someone later: **Change access** on their row. To take access away:
**Remove**. Their login is not deleted; they simply stop being an admin.

Two things the panel will not let you do, on purpose: change your own role,
and leave the panel with no main admin at all.

**One-time set-up by a developer** (both needed, in this order):

1. Run the latest `schema.sql` in the Supabase SQL editor. Section 34 adds the
   roles. Every admin who already existed keeps all of their pages; one of
   them becomes the main admin.
2. Deploy the function that creates a login for a new team member:
   ```
   supabase functions deploy admin-users
   supabase functions deploy bkash-payment
   ```
   `admin-users` is new. `bkash-payment` is redeployed because refunds now
   require the "Orders & payments" page, not just being an admin.

Until step 1 is done the panel works exactly as before: every admin can do
everything, and the Team page says the database still needs updating.

## Facebook ads (Meta Pixel)

Admin panel → **Facebook ads**. This is what lets Facebook and Instagram ads
count sales from the website and show ads to the people most likely to buy.

- **The Pixel itself is in every public page.** Meta's base code sits in the
  `<head>` of every page (search the page source for "Meta Pixel Code" or the
  Pixel ID), so it loads first and every page view is sent. Admin pages do
  not carry it.
- **The big switch** controls everything after the page view: course and
  product views, checkouts, purchases, sign-ups and contact messages, and the
  server's purchase reports. Green "চালু" = all of it is sent. Off = Facebook
  gets page views only, and cannot count sales.
- **The checks** under it say in plain words whether the Pixel code is really
  on the site's pages (the panel opens the homepage, a course page, checkout
  and the after-payment page and looks), whether the Pixel ID is saved,
  whether the server's connection to Facebook works, whether sales reporting
  is on, and which ad account is connected. All green means everything works.
- **Changing to a different Pixel** means changing the ID in every page's
  `<head>` code and in the panel's settings row (`site_settings`
  "meta_pixel"), so it is a developer job, not a panel setting.
- **"বিজ্ঞাপনের ফলাফল"** (ad results): pick আজ / গত ৭ দিন / গত ৩০ দিন /
  এই মাস / সব সময় and see money spent, sales from ads, cost per sale,
  return on ad spend, people reached and clicks, plus the same per campaign.
  Beside them, the website's own paid orders over the same days.
- **"কাজ করছে কিনা পরীক্ষা করুন"** (check it works): open Events Manager →
  your Pixel → Test events, copy the code that starts with `TEST`, paste it,
  press Send test. A PageView and a Purchase appear in Facebook within
  seconds. Test events are not counted as real visits or sales.

What the website reports: page views, course and product views, checkout
started, purchases (with the amount, in BDT), new accounts and contact-form
messages. Purchases are reported twice — by the browser and by the server
after bKash confirms the money — with the same order number, so Facebook
counts each sale once even when an ad blocker stops the browser. Payments in
the bKash sandbox and free courses are never reported as sales. Phone numbers
and emails are sent only as SHA-256 codes.

**One-time set-up by a developer:**

1. Store the two Meta keys as server secrets (never in the code or the
   database):
   ```
   supabase secrets set META_CAPI_TOKEN=<Conversions API token from Events Manager>
   supabase secrets set META_ADS_READ_TOKEN=<system user token with ads_read>
   ```
   The first SENDS events. The second only READS ad results for the
   "বিজ্ঞাপনের ফলাফল" section; with ads_read alone it cannot change an ad or
   spend money. The ad account number is entered on the page itself, under
   "উন্নত সেটিংস".
2. Deploy the functions:
   ```
   supabase functions deploy meta-ads
   supabase functions deploy bkash-payment
   supabase functions deploy bkash-callback --no-verify-jwt
   ```
3. Run the latest `schema.sql` (section 37) so "Facebook ads" can be ticked
   for a limited admin on Team & access. Main admins can use the page without
   it.

To replace the access token later (for example if Facebook says it is no
longer valid), repeat step 1 with the new one. Nothing else changes.

## Course price and discount

In the course editor, section **2. Price**:

- **Price now** — what the student pays.
- **Original price** — optional. Put the price before the discount here and
  the site shows it crossed out beside the real price, with a "সেল" badge on
  the course card and the percentage off on the course page. It has to be
  higher than the price now. Leave it empty for no discount.

The box under the two numbers shows exactly what a visitor will see. The
original price is display only: the checkout always charges "Price now".

## Free preview lessons

On a paid course every lesson is locked until someone buys. To let visitors
try before they buy, open the course → section **3. Lessons** → on any
**video** lesson tick **Free preview**. That one video can then be watched by
anyone, with a green "ফ্রি প্রিভিউ" tag beside it; every other lesson stays
locked. Untick it to lock it again.

Only videos can be free previews. This is separate from the **Trailer video**
in section 4, which is the single video shown at the top of the course page.

## Building a course's content

Each course is built from content blocks you add in any order from the course
editor (Courses → **Edit** → section "3. Lessons"):

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

- Until you complete Step 4, the public website still opens, but its course
  and store pages are empty (there is no sample content), and
  `admin/login.html` will show a "not connected" message instead of a login
  form.
- Product/course images you upload in the admin panel are stored in
  Supabase's free file storage (created automatically by `schema.sql`).
- Analytics are cookie-free and only count page visits — no personal data,
  no third-party trackers.
