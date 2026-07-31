/* =========================================================
   section-visibility.js
   ---------------------------------------------------------
   Lets the admin panel hide a whole homepage/portfolio
   section from the public without deleting anything, e.g.
   "hide the About section for a month".

   Each hideable block is marked in the HTML with
   <section data-section-key="about"> and matched against the
   `is_visible` column of that key's row in Supabase's
   home_content table. If is_visible is false the section is
   hidden (display:none) for everyone — except a logged-in
   admin, who still sees it with a small "hidden from
   visitors" flag so they can keep working on it.

   Anything unusual (Supabase not configured, request fails,
   no matching row) leaves the page exactly as authored — a
   section is only ever hidden on an explicit false.
   ========================================================= */
(function () {
  "use strict";

  function client() {
    if (window.ShahedinAuth && window.ShahedinAuth.configured()) return window.ShahedinAuth.client();
    if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) return null;
    if (typeof window.supabase === "undefined") return null;
    return window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
  }

  // Same admin test the admin panel uses: a session, plus a row in `admins`
  // for that user. RLS only lets someone read their own admins row, so a
  // logged-in student simply gets nothing back here.
  async function isAdmin(c) {
    try {
      const user = window.ShahedinAuth ? await window.ShahedinAuth.getUser() : null;
      if (!user) return false;
      const { data, error } = await c.from("admins").select("id").eq("id", user.id).maybeSingle();
      return !error && !!data;
    } catch (e) {
      return false;
    }
  }

  async function load() {
    const sections = document.querySelectorAll("[data-section-key]");
    if (!sections.length) return;

    const c = client();
    if (!c) return;

    try {
      const { data, error } = await c.from("home_content").select("key,is_visible");
      if (error || !data) return; // e.g. schema.sql not re-run yet — show everything

      const hidden = new Set(data.filter((row) => row.is_visible === false).map((row) => row.key));
      if (!hidden.size) return;

      const admin = await isAdmin(c);
      sections.forEach((section) => {
        if (!hidden.has(section.dataset.sectionKey)) return;
        if (admin) section.classList.add("section-hidden-from-public");
        else section.style.display = "none";
      });
    } catch (e) {
      // never break the page over section visibility
    }
  }

  function ready(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }

  ready(load);
})();
