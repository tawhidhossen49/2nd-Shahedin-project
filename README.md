# Shahedin — Personal Brand Website

Plain **HTML / CSS / JavaScript**. No build step, no framework, no npm install.
Open it with Live Server (VS Code / Antigravity) and everything just works.

## Admin panel

`admin/` is a zero-code admin panel: log in, then edit homepage and portfolio
copy, add/edit/remove courses and store products, moderate reviews, hide whole
sections from the public, and view analytics — changes show up on the live site
immediately. It talks to a free Supabase database.

**If it isn't connected yet**, see `ADMIN_SETUP.md` for a step-by-step guide
(~15 minutes, no coding). Until then the public website keeps working exactly
as before, using the sample content in `js/data.js`.

## How to run it

1. Unzip this folder.
2. Open the folder in VS Code (or Antigravity).
3. Right-click `index.html` → **Open with Live Server**.

Don't just double-click `index.html` in your file explorer — a couple of
features (fetching data, some relative paths) behave better over
`http://localhost` than over `file://`.

## Folder structure

```
index.html             Home
courses.html           Course catalogue (filterable)
course-detail.html     Single course — reads ?id= from the URL
store.html             Store catalogue (filterable)
product-detail.html    Single product — reads ?id= from the URL
checkout.html          Single-item checkout (bKash)
portfolio.html         Media kit / partnership page
contact.html           Contact form (saves to Admin → Contact Messages)
                        + booking calendar
dashboard.html         Student dashboard (courses, resources, certificates)

admin/                 Zero-code admin panel (see ADMIN_SETUP.md)
schema.sql             Supabase schema — run once when setting up
js/supabase-config.js  Your Supabase URL + anon key (used by site and admin)

css/tokens.css         Design tokens. Loaded by the public site AND the admin
                        panel, so the two can never drift apart.
css/style.css          The design system built on those tokens.

js/data.js             Sample course/product content (fallback when Supabase
                        isn't connected).
js/data-loader.js      Swaps in live Supabase content when it is.
js/render.js           Turns that data into cards and detail pages.
js/home-content.js     Applies admin-editable copy via data-field / data-repeat.
                        The shared "stats" row means editing a stat once
                        updates it on every page that shows it.
js/site-settings.js    Applies admin-editable contact details and social
                        links via data-link (href) / data-setting (text).
                        Loaded on every page, so the footer social icons and
                        contact info are edited in ONE place.
js/contact-form.js     Sends the contact form to Supabase, where it shows up
                        in Admin → Contact Messages.
js/section-visibility.js  Hides sections the admin has switched off.
js/auth.js             Student accounts (name + phone + SMS OTP).
js/main.js             Nav, mobile menu, reveals, tabs, accordion, filters.
js/motion.js           Counters, parallax, scroll progress, staggered entrances.
js/course-progress.js  Enrolment + per-lesson progress.
js/course-reviews.js   Course reviews.
js/checkout.js         Order + enrolment writes.
js/dashboard.js        The whole student dashboard UI.

assets/img/shahedin-cutout.png / .webp   Portrait cutout (footer, hero, story)
assets/shahedin-media-kit.pdf            Downloadable media kit
```

## The design system

Everything visual derives from `css/tokens.css`. Change a value there and it
propagates to every page and to the admin panel. Three things are worth knowing
before editing it:

**Legacy token aliases are load-bearing.** `js/render.js`, `js/dashboard.js` and
`js/course-reviews.js` write inline styles like `color:var(--text-muted)` into
their template strings. Every pre-redesign token name is kept as an alias onto
the new system. Deleting one breaks rendered markup that no CSS file mentions.

**Type is Bangla-first.** A Bengali serif (Noto Serif Bengali) for display, a
Bengali sans (Anek Bangla) for text, and Inter for numerals and Latin
fragments. Mixed-script lines use `--font-mixed`, which lists Inter first —
Inter has no Bengali glyphs, so Bengali falls through to Anek Bangla within the
same line. That plus `font-size-adjust` is what keeps `৳১,৪৯০`, `4.9/5`,
`bKash` and `PDF` on the same baseline as the Bangla around them.

**Contrast is checked, not guessed.** Every text token is annotated with its
measured WCAG ratio against every surface it is used on. If you change a
colour, re-check both numbers. The accent is deliberately split: `--accent-fill`
for solid blocks with white text, `--accent-ink` (much lighter) for accent
*text*, which needs to clear 4.5:1 on its own.

## The JS ↔ HTML contract

The pages and the JavaScript are joined by attributes, not by structure. These
must survive any redesign, on the same element, with the same value:

- `data-mount="…"` — where render.js, checkout.js and dashboard.js inject HTML
- `data-field="section.field"` / `data-repeat="section.list"` — admin-editable copy
- `data-section-key="…"` — sections the admin can hide
- behavioural hooks: `data-enroll`, `data-buy-product`, `data-qty-*`, `data-tabs`,
  `data-tab-target`, `data-tab-panel`, `data-filterable`, `data-filter-group`,
  `data-search-input`, `data-empty-state`, `data-cal-grid`, `data-quiz`, …
- classes the JS toggles: `.active`, `.open`, `.inview`, `.show`, `.scrolled`,
  `.selected`, `.is-correct`, `.is-wrong`, `.section-hidden-from-public`

Restyle any of them freely. Renaming one silently breaks a page.

## Motion

`js/motion.js` runs every scroll-driven effect off **one** rAF loop and **one**
passive scroll listener, and animates only `transform` and `opacity` — nothing
in it can trigger layout. `prefers-reduced-motion: reduce` disables all of it
and jumps every element to its final state.

## Responsive

Verified at 1440 / 1280 / 1080 / 760 / 480 / 380, with both long and one-word
content in every text field. Every grid uses `minmax(0, …)` so a long unbroken
Bangla label can't push a column past its container.

## Known follow-ups

- **Fonts still swap.** Metric-matched fallback faces remove the layout shift,
  but a truly flash-free load needs the woff2 files self-hosted in `assets/`
  with `font-display:optional`.
- **The YouTube API key in `js/youtube-videos.js` is public** — unavoidable in a
  static site, but it should be restricted to your domain by HTTP referrer in
  the Google Cloud console.
- **The portrait asset is doing three jobs.** `shahedin-cutout.webp` was shot as
  a footer cutout. Each of the three places it now appears is framed to suit it,
  and the ideal replacement for each is commented at the CSS rule.
