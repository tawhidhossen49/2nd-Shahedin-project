/* =========================================================
   site-settings.js
   ---------------------------------------------------------
   Applies the contact details and social links saved in the
   admin panel (Settings page → site_settings table) onto every
   public page, so the footer social icons, the contact email,
   the WhatsApp link and the business phone number are all
   edited in ONE place and update everywhere at once.

   Two attributes drive this, and an element may use both:

     data-link="social.youtube"
        Sets the element's href. Values that already look like
        a URL (http…, mailto:, tel:, /path, #anchor) are used
        as-is. A bare email becomes mailto:…, a bare phone
        number becomes tel:… — so the admin can paste either
        form and it just works.

     data-setting="contact.email"
        Sets the element's visible text (or an <img> src).

   Optional extras:

     data-hide-if-empty
        If the setting loaded successfully but the value is
        blank, hide this element. That's what lets an admin
        remove, say, the LinkedIn icon from every footer just
        by clearing the LinkedIn field in the admin panel.

   Safety: if Supabase isn't configured, is unreachable, or a
   given key has no saved value, the hardcoded Bangla text and
   placeholder links already in the HTML are left exactly as
   they are. This file can never blank out or break a page.

   It also caches the fetch on window.SiteSettings so other
   scripts (js/support-widget.js) can reuse the same result
   instead of hitting the network a second time.
   ========================================================= */
(function () {
  "use strict";

  var CACHE = null; // resolved settings object, e.g. { contact: {...}, social: {...} }

  function isConfigured() {
    return !!(window.SUPABASE_URL && window.SUPABASE_ANON_KEY && typeof window.supabase !== "undefined");
  }

  /* ---------- Turn a saved value into a usable href ---------- */
  function toHref(key, raw) {
    var val = (raw == null ? "" : String(raw)).trim();
    if (!val) return "";

    // Already a complete link of some kind — leave it alone.
    if (/^(https?:|mailto:|tel:|\/|#)/i.test(val)) return val;

    // A bare domain, with or without a path, gets https://.
    // This is checked BEFORE the email test on purpose: social handles like
    // "youtube.com/@shahedin" contain an @ but are emphatically not emails.
    if (/^[\w-]+(\.[\w-]+)+([/?#].*)?$/.test(val)) return "https://" + val;

    // A bare email address becomes a mailto: link. Must look like
    // local@domain.tld with no slashes or spaces, so a URL can't match.
    if (/^[^\s/@]+@[^\s/@]+\.[^\s/@]+$/.test(val)) return "mailto:" + val;

    // A bare phone number on a phone field becomes a tel: link.
    if (/phone|tel/i.test(key) && /^[+\d][\d\s\-().]*$/.test(val)) {
      return "tel:" + val.replace(/[\s\-().]/g, "");
    }

    return val;
  }

  /* ---------- Read "section.field" out of the settings object ---------- */
  function lookup(settings, path) {
    var parts = String(path || "").split(".");
    var section = settings[parts[0]];
    if (!section || typeof section !== "object") return undefined;
    return section[parts[1]];
  }

  /* ---------- Apply everything to the current page ---------- */
  function apply(settings) {
    // 1. Links (href)
    document.querySelectorAll("[data-link]").forEach(function (el) {
      var path = el.getAttribute("data-link");
      var raw = lookup(settings, path);

      // Key genuinely missing from the database → keep the baked-in href.
      if (raw === undefined || raw === null) return;

      var val = String(raw).trim();
      if (!val) {
        // Saved but deliberately cleared by the admin.
        if (el.hasAttribute("data-hide-if-empty")) el.style.display = "none";
        return;
      }

      el.style.removeProperty("display");
      el.setAttribute("href", toHref(path, val));
    });

    // 2. Visible text (or image src)
    document.querySelectorAll("[data-setting]").forEach(function (el) {
      var path = el.getAttribute("data-setting");
      var raw = lookup(settings, path);
      if (raw === undefined || raw === null) return;

      var val = String(raw).trim();
      if (!val) {
        if (el.hasAttribute("data-hide-if-empty")) el.style.display = "none";
        return;
      }

      el.style.removeProperty("display");
      if (el.tagName === "IMG") el.src = val;
      else el.textContent = val;
    });

    // 3. Let anything else on the page react (e.g. the support widget).
    document.dispatchEvent(new CustomEvent("sitesettings-ready", { detail: settings }));
  }

  /* ---------- Fetch once, share the promise ---------- */
  function fetchSettings() {
    if (CACHE) return Promise.resolve(CACHE);
    if (!isConfigured()) return Promise.resolve(null);

    return (async function () {
      try {
        var client = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
        var res = await client.from("site_settings").select("key,value");
        if (res.error || !res.data) return null;

        var settings = {};
        res.data.forEach(function (row) {
          settings[row.key] = row.value || {};
        });
        CACHE = settings;
        return settings;
      } catch (e) {
        // Offline, wrong keys, table missing — the page keeps its baked-in content.
        return null;
      }
    })();
  }

  var readyPromise = null;
  function ready() {
    if (!readyPromise) readyPromise = fetchSettings();
    return readyPromise;
  }

  window.SiteSettings = {
    ready: ready,
    get: function (path) {
      return CACHE ? lookup(CACHE, path) : undefined;
    },
  };

  function start() {
    ready().then(function (settings) {
      if (settings) apply(settings);
      else document.dispatchEvent(new CustomEvent("sitesettings-ready", { detail: null }));
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
