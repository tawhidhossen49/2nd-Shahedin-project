/* =========================================================
   meta-pixel.js — the Meta (Facebook) Pixel's events
   ---------------------------------------------------------
   Facebook's own base code sits in the <head> of every public
   page (look for "Meta Pixel Code"). That is what loads the
   Pixel and sends PageView, and it is where Meta, and anyone
   checking with Ctrl+U, expects to find it.

   This file sends everything after the page view, using that
   same fbq -- but only while Admin -> Facebook ads has the
   switch on (site_settings row "meta_pixel"). It never loads
   Facebook again and never sends a second PageView.

   What it reports, so Facebook ads can count sales and find
   buyers (every course/product event carries content_name,
   content_ids, content_type "product", value and currency BDT):
     PageView              every page          (the <head> code, always)
     ViewContent           a course or product page
     InitiateCheckout      the "কিনুন" click     (course-progress.js, main.js)  + server
     AddPaymentInfo        the payment page opened  (checkout.js)
     CompleteRegistration  a new account       (auth.js)                        + server
     Lead                  contact form sent   (contact-form.js)
     Purchase              bKash confirmed, on the return page (payment-status.js) + server

   "+ server": the server reports the same event through the
   Conversions API (server/app/meta.php) with the SAME event id
   (ic_<random>, reg_<user id>, order_<order id>), so Facebook
   keeps one of the two and an ad blocker cannot hide them.

   It also keeps Facebook's two first-party cookies alive, so an
   ad click is still credited after the visitor moves between
   pages or comes back from bKash:
     _fbc  "fb.1.<time>.<fbclid>"  written whenever a page is
           opened with ?fbclid= (an ad click), for 90 days
     _fbp  the browser id; created if the Pixel could not
   Both are sent to the server with checkout and sign-up.

   Other scripts never call fbq() directly. They call
   window.ShahedinPixel.track(), which waits until the Pixel
   is known to be on and quietly does nothing if it is off.
   ========================================================= */
(function () {
  "use strict";

  var state = "waiting"; // waiting -> on | off
  var queue = [];

  function send(name, params, eventId) {
    // No fbq means the <head> code is missing or an ad blocker stopped it.
    // Nothing to send to, and nothing to break.
    if (typeof window.fbq !== "function") return;
    try {
      if (eventId) window.fbq("track", name, params || {}, { eventID: eventId });
      else window.fbq("track", name, params || {});
    } catch (e) {
      // Tracking must never break the page.
    }
  }

  /* ---------- _fbp / _fbc ---------- */

  function readCookie(name) {
    var m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
    return m ? decodeURIComponent(m[1]) : "";
  }

  /* On the site's own domain (.shahedin.com), like the Pixel does, so every
     subdomain sees it. The shortest domain the browser accepts is the right
     one: it refuses public suffixes such as .com or .vercel.app. */
  function writeCookie(name, value) {
    var tail = "=" + value + "; path=/; max-age=" + 90 * 86400 + "; SameSite=Lax";
    var parts = location.hostname.split(".");
    for (var i = parts.length - 2; i >= 0; i--) {
      document.cookie = name + tail + "; domain=." + parts.slice(i).join(".");
      if (readCookie(name) === value) return;
    }
    document.cookie = name + tail;
  }

  try {
    var fbclid = new URLSearchParams(window.location.search).get("fbclid");
    if (fbclid && /^[\w.-]{1,500}$/.test(fbclid)) {
      var current = readCookie("_fbc");
      if (current.split(".").slice(3).join(".") !== fbclid) writeCookie("_fbc", "fb.1." + Date.now() + "." + fbclid);
    }
    if (!readCookie("_fbp")) writeCookie("_fbp", "fb.1." + Date.now() + "." + Math.floor(1e9 + Math.random() * 9e9));
  } catch (e) {
    // Cookies blocked: the Pixel itself still runs.
  }

  function newEventId(prefix) {
    var id = window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID()
      : Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12);
    return prefix + id;
  }

  window.ShahedinPixel = {
    /* name: a Meta standard event; params: { value, currency, ... };
       eventId: for events the server also reports, the id both copies share. */
    track: function (name, params, eventId) {
      if (state === "on") send(name, params, eventId);
      else if (state === "waiting") queue.push([name, params, eventId]);
    },

    /* Facebook's browser and ad-click ids, for the server's copy of an event. */
    ids: function () {
      return { fbp: readCookie("_fbp") || null, fbc: readCookie("_fbc") || null };
    },

    /* The "কিনুন" click. item: { kind: "course"|"product", slug, dbId, title, price, qty }.
       Sent by the browser AND, with the same event id, by the server (which
       prices the item itself). Resolves after a short moment, so the caller
       can change page without cutting the two reports off. */
    initiateCheckout: function (item) {
      var eventId = newEventId("ic_");
      var qty = Math.max(1, Number(item.qty) || 1);
      window.ShahedinPixel.track("InitiateCheckout", {
        content_name: item.title,
        content_ids: [String(item.dbId || item.slug)],
        content_type: "product",
        content_category: item.kind,
        num_items: qty,
        value: (Number(item.price) || 0) * qty,
        currency: "BDT",
      }, eventId);
      try {
        var c = window.ShahedinAuth && window.ShahedinAuth.client();
        var ids = window.ShahedinPixel.ids();
        if (c) {
          c.functions.invoke("meta-event", {
            keepalive: true,
            body: { event: "InitiateCheckout", event_id: eventId, kind: item.kind, slug: item.slug, qty: qty,
                    url: window.location.href, fbp: ids.fbp, fbc: ids.fbc },
          }).catch(function () {});
        }
      } catch (e) {
        // Tracking must never stop a sale.
      }
      return new Promise(function (resolve) { setTimeout(resolve, 300); });
    },
  };

  function qs(name) {
    return new URLSearchParams(window.location.search).get(name);
  }

  var page = (window.location.pathname.split("/").pop() || "index").toLowerCase().replace(/\.html$/, "");

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

  if (page === "product-detail") {
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
