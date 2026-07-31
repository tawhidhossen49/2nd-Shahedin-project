/* =========================================================
   analytics.js
   ---------------------------------------------------------
   Records one row per page view into Supabase's page_views
   table, so the admin panel's Analytics page has data to show.
   No cookies, no third-party trackers. Does nothing if Supabase
   isn't configured yet.
   ========================================================= */
(function () {
  "use strict";
  if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) return;
  if (typeof window.supabase === "undefined") return;

  function currentLang() {
    return "bn"; // the site is Bangla-only now — kept as a field for future use
  }

  function record() {
    try {
      const client = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
      client.from("page_views").insert({
        page_path: window.location.pathname.split("/").pop() || "index.html",
        referrer: document.referrer || null,
        lang: currentLang(),
      }).then(() => {});
    } catch (e) {
      // analytics should never break the site
    }
  }

  if (document.readyState !== "loading") record();
  else document.addEventListener("DOMContentLoaded", record);
})();
