/* =========================================================
   support-widget.js
   ---------------------------------------------------------
   A floating support button, bottom-right, on every page.
   Clicking it opens a WhatsApp chat. The link comes from the
   admin panel (Settings → Contact → WhatsApp chat link,
   site_settings.contact.whatsapp) so it can be changed at any
   time without touching code.

   Until that's set (or if Supabase isn't configured), the
   button still shows up using the placeholder link below —
   replace it from the admin panel with your real WhatsApp
   link, e.g. https://wa.me/8801XXXXXXXXX
   ========================================================= */
(function () {
  "use strict";

  var DEFAULT_LINK = "https://wa.me/8801XXXXXXXXX"; // placeholder — set the real one in the admin panel

  function isSupabaseConfigured() {
    return !!(window.SUPABASE_URL && window.SUPABASE_ANON_KEY && typeof window.supabase !== "undefined");
  }

  function injectButton(link) {
    if (document.getElementById("supportWidgetBtn")) return;
    var a = document.createElement("a");
    a.id = "supportWidgetBtn";
    a.className = "support-widget-btn";
    a.href = link;
    a.target = "_blank";
    a.rel = "noopener";
    a.setAttribute("aria-label", "হোয়াটসঅ্যাপে সাপোর্টের সাথে চ্যাট করুন");
    a.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M21.75 8.51c.88.29 1.5 1.13 1.5 2.1v4.29c0 1.13-.85 2.1-1.98 2.19-.34.03-.68.05-1.02.07v3.09l-3-3c-1.35 0-2.69-.06-4.02-.16a2.1 2.1 0 0 1-.83-.25" />' +
      '<path d="M15.42 8.36a48.6 48.6 0 0 0-8.05 0c-1.13.1-1.97 1.06-1.97 2.2v4.28c0 .84.46 1.58 1.15 1.95m9.34-8.34V6.64c0-1.62-1.15-3.03-2.76-3.24a48.46 48.46 0 0 0-6.24-.4c-2.11 0-4.2.14-6.24.4-1.6.21-2.76 1.62-2.76 3.24v6.23c0 1.62 1.15 3.03 2.76 3.24.58.07 1.16.14 1.74.19v3.9l4.16-4.15" />' +
      "</svg>";
    document.body.appendChild(a);
  }

  async function loadLinkAndInject() {
    injectButton(DEFAULT_LINK); // show right away — never make visitors wait on a network round trip for this

    if (!isSupabaseConfigured()) return;
    try {
      var client = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
      var res = await client.from("site_settings").select("value").eq("key", "contact").maybeSingle();
      var link = res && res.data && res.data.value && res.data.value.whatsapp;
      if (link && typeof link === "string" && link.trim()) {
        var btn = document.getElementById("supportWidgetBtn");
        if (btn) btn.href = link.trim();
      }
    } catch (e) {
      // Supabase unreachable/misconfigured — keep the placeholder link, never break the page over this.
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadLinkAndInject);
  } else {
    loadLinkAndInject();
  }
})();
