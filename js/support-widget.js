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
    // The actual WhatsApp mark — the link opens wa.me, so the glyph has to match.
    a.innerHTML =
      '<svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
      '<path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>' +
      '<path d="M20.52 3.449A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.423-8.452zm-8.464 18.297h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.861 9.861 0 0 1-1.51-5.26c.002-5.45 4.436-9.884 9.888-9.884a9.825 9.825 0 0 1 6.988 2.896 9.83 9.83 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884z"/>' +
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
