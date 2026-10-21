/* =========================================================
   meta-pixel.js — the Meta (Facebook) Pixel
   ---------------------------------------------------------
   Loads Facebook's tracking code on every public page, but
   ONLY when Admin -> Facebook ads has it switched on with a
   Pixel ID saved (the site_settings row "meta_pixel"). With
   it off, or no ID, this file does nothing at all: no
   Facebook code is downloaded and no cookie is set.

   What it reports, so Facebook ads can count sales and find
   buyers:
     PageView          every page
     ViewContent       a course or product page
     InitiateCheckout  checkout opened with an item   (checkout.js)
     Purchase          bKash payment confirmed        (payment-status.js)
     Lead              contact form sent              (contact-form.js)
     CompleteRegistration  a new account created      (auth.js)

   Purchases are ALSO reported by the server (supabase/
   functions/_shared/meta.ts) with the same event id,
   "order_<id>", so Facebook keeps one of the two and an ad
   blocker cannot hide a sale.

   Other scripts never call fbq() directly. They call
   window.ShahedinPixel.track(), which waits until the Pixel
   is known to be on and quietly does nothing if it is off.
   ========================================================= */
(function () {
  "use strict";

  var state = "waiting"; // waiting -> on | off
  var queue = [];

  function send(name, params, eventId) {
    try {
      if (eventId) window.fbq("track", name, params || {}, { eventID: eventId });
      else window.fbq("track", name, params || {});
    } catch (e) {
      // Tracking must never break the page.
    }
  }

  window.ShahedinPixel = {
    /* name: a Meta standard event; params: { value, currency, ... };
       eventId: only for events the server also reports (Purchase). */
    track: function (name, params, eventId) {
      if (state === "on") send(name, params, eventId);
      else if (state === "waiting") queue.push([name, params, eventId]);
    },
  };

  /* Facebook's standard loader, unchanged apart from layout. It defines fbq
     straight away (calls made before the real script arrives are queued by
     fbq itself) and downloads fbevents.js in the background. */
  function loadFacebook(pixelId) {
    /* eslint-disable */
    !function (f, b, e, v, n, t, s) {
      if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
      if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = "2.0"; n.queue = [];
      t = b.createElement(e); t.async = !0; t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
    }(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");
    /* eslint-enable */
    window.fbq("init", pixelId);
    window.fbq("track", "PageView");
  }

  function qs(name) {
    return new URLSearchParams(window.location.search).get(name);
  }

  var page = (window.location.pathname.split("/").pop() || "index.html").toLowerCase();

  /* ViewContent for course and product pages. The course page announces
     itself with "course-mounted" once render.js knows which course it is;
     the product page is looked up from the same data render.js drew from. */
  document.addEventListener("course-mounted", function () {
    var c = window.SHAHEDIN_CURRENT_COURSE;
    if (!c) return;
    var course = ((window.SITE_DATA && window.SITE_DATA.courses) || []).find(function (x) { return x.id === c.slug; }) || {};
    window.ShahedinPixel.track("ViewContent", {
      content_ids: [String(c.dbId || c.slug)],
      content_type: "product",
      content_name: c.title,
      content_category: "course",
      value: c.free ? 0 : Number(course.price != null ? course.price : c.price) || 0,
      currency: "BDT",
    });
  });

  if (/(^|[-_])product-detail\.html$/.test(page)) {
    document.addEventListener("sitedata-ready", function () {
      var id = qs("id");
      var p = ((window.SITE_DATA && window.SITE_DATA.products) || []).find(function (x) { return x.id === id; });
      if (!p) return;
      window.ShahedinPixel.track("ViewContent", {
        content_ids: [String(p.dbId || p.id)],
        content_type: "product",
        content_name: p.title,
        content_category: "product",
        value: Number(p.price) || 0,
        currency: "BDT",
      });
    });
  }

  function start() {
    var settingsReady = window.SiteSettings && window.SiteSettings.ready ? window.SiteSettings.ready() : Promise.resolve(null);
    settingsReady.then(function (settings) {
      var cfg = settings && settings.meta_pixel;
      var id = cfg && String(cfg.pixel_id || "").trim();
      if (!cfg || cfg.enabled !== true || !/^\d{6,20}$/.test(id || "")) {
        state = "off";
        queue = [];
        return;
      }
      loadFacebook(id);
      state = "on";
      queue.splice(0).forEach(function (q) { send(q[0], q[1], q[2]); });
    }).catch(function () {
      state = "off";
      queue = [];
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
