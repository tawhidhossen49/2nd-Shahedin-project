# Shahedin — Personal Brand Website

Plain **HTML / CSS / JavaScript**. No build step, no framework, no npm install.
Open it with Live Server (VS Code / Antigravity) and everything just works.

## Admin panel (new)

`admin/` is a zero-code admin panel: log in, then add/edit/remove courses and
store products, and view website analytics — changes show up on the live
site immediately. It talks to a free Supabase database.

**It's not connected yet.** See `ADMIN_SETUP.md` for a step-by-step guide
(~15 minutes, no coding). Until then, the public website keeps working
exactly as before, using the sample content in `js/data.js`.

## How to run it

1. Unzip this folder.
2. Open the folder in VS Code (or Antigravity).
3. Right-click `index.html` → **Open with Live Server** (or use the Live Share / Live Preview button your IDE gives you).
4. That's it — the whole site, cart, language toggle, and hero effect run client-side.

Don't just double-click `index.html` in your file explorer — a couple of features (fetching data, some relative paths) behave better over `http://localhost` than over `file://`. Live Server / Live Preview already serves it correctly.

## Folder structure

```
index.html            Home page
courses.html           Course catalog (filterable)
course-detail.html     Single course page — reads ?id= from the URL
store.html             Store catalog (filterable)
product-detail.html    Single product page — reads ?id= from the URL
checkout.html          Mock checkout (bKash / Nagad / Card placeholders)
partner.html           Media kit / "Partner With Me" page
blog.html              Knowledge hub listing (filterable)
blog-post.html         Single article — reads ?slug= from the URL
contact.html           Contact form + booking calendar
dashboard.html         Student dashboard (enrolled courses, resources, certs)

admin/                 Zero-code admin panel (see ADMIN_SETUP.md)
schema.sql              Supabase database schema — run once when setting up
js/supabase-config.js   Paste your Supabase URL + anon key here (one file, used by site + admin)

css/style.css          Entire design system (tokens, components, responsive)

js/data.js             All course/product/video/blog content lives here —
                        edit this file to change what's on the site.
js/render.js           Turns data.js into HTML cards + detail pages.
js/i18n.js             English / Bangla toggle (dictionary + apply logic).
js/cart.js             Cart + enrollment logic (saved in localStorage).
js/main.js             Nav, mobile menu, scroll reveals, tabs, accordion,
                        filters, toasts, calendar widget.
js/section-visibility.js  Hides a <section data-section-key="..."> from the
                        public when the admin panel turns it off (admins
                        still see it, flagged).

assets/img/shahedin-cutout.png / .webp   Hero + footer cutout portrait
assets/shahedin-media-kit.pdf  Downloadable media kit (Partner page)
```

## Editing content

Almost everything repeatable (courses, products, videos, blog posts) is
data-driven. To add/change a course, product, or article, edit the arrays
in `js/data.js` — the catalog pages, cards, and detail pages update
automatically, and every "View" link automatically points to a working
detail page (`course-detail.html?id=your-id`).

## Language toggle

Click **EN / বাং** in the nav or footer. It's a real toggle: it swaps text
via `data-i18n="key"` attributes (dictionary in `js/i18n.js`), switches the
whole page to the **Anek Bangla** font, and remembers your choice in
localStorage. Long-form content (blog articles, testimonial quotes) is
English-only for now — add Bangla strings to the `DICT` object in
`js/i18n.js` to extend it further.

## The two custom builds from the brief

- **Two-column hero**: copy on the left (eyebrow, headline, three CTAs,
  stat row) and the cutout portrait on the right, built on the same
  `.about-grid` / `.about-portrait` pattern the About section uses. The
  photo is swappable from the admin panel (`hero.image_url`).
- **Footer cutout**: transparent PNG/WebP of Shahedin sitting directly on
  the footer background (no card, no border), feathered at the feet,
  color-graded to match the footer tone, with one soft contact shadow and
  a subtle scroll parallax.

## No dead ends

Every button on the site goes somewhere: nav links, CTAs, "Enroll",
"Add to Cart" → cart drawer → `checkout.html`, contact form, newsletter
signup, blog comments, and the calendar booking widget all respond with
real (front-end) behavior. Payment (bKash/Nagad/SSLCommerz) and the
backend for courses/e-commerce are mocked with `localStorage` — swap
those calls for real API requests when the backend is ready (the brief
asked for front-end structure + the two interactive builds first).

## Responsive

Tested breakpoints at 1080px, 760px, and 480px. Mobile gets a full-screen
menu, a stacked hero stat grid, a single-column hero (photo below the
copy), and a reflowed footer (portrait moves above the link columns instead of beside
them).
