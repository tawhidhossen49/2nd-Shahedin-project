/* =========================================================
   section-visibility.js
   ---------------------------------------------------------
   Lets the admin panel hide a whole homepage/portfolio
   section from the public without deleting it, e.g. "hide the
   About section for a month".

   Each hideable block is marked in the HTML with
   <section data-section-key="about"> and matched against the
   `is_visible` column of that key's row in Supabase's
   home_content table. If is_visible is false the section is
   hidden for everyone — except a logged-in admin, who still
   sees it flagged as hidden so they can keep working on it.

   ---------------------------------------------------------
   NO-FLASH HANDSHAKE (the section used to paint, then vanish
   a few hundred ms later once Supabase answered):

     1. A tiny inline script in each page's <head> reads the
        LAST KNOWN hidden list from localStorage and injects
        <style id="sv-pre"> hiding those sections. That runs
        before the body is parsed, so nothing paints first.
     2. This file then asks Supabase for the real state.
     3. Whatever happens next, #sv-pre is removed:
          · answer says hidden  -> hidden for real, cache updated
          · answer says visible -> shown, cache updated
          · error / timeout / not configured -> shown
        so the page still FAILS OPEN. A stale cache can only
        ever hide something for the few hundred ms before the
        answer lands, never for a whole visit.

   The 2.5s failsafe below guarantees step 3 even if the
   request never settles.
   ========================================================= */
(function () {
  "use strict";

  const CACHE_KEY = "sv-hidden";
  const FAILSAFE_MS = 2500;

  function dropPreStyle() {
    const pre = document.getElementById("sv-pre");
    if (pre) pre.remove();
  }

  function writeCache(keys) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(keys));
    } catch (e) {
      /* private mode / quota — the cache is an optimisation, not a dependency */
    }
  }

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

  function apply(hidden, admin) {
    document.querySelectorAll("[data-section-key]").forEach((section) => {
      const key = section.dataset.sectionKey;
      const shouldHide = hidden.has(key);
      section.classList.toggle("section-hidden-from-public", shouldHide && admin);
      section.style.display = shouldHide && !admin ? "none" : "";
    });
  }

  async function load() {
    const sections = document.querySelectorAll("[data-section-key]");
    if (!sections.length) {
      dropPreStyle();
      return;
    }

    const c = client();
    if (!c) {
      dropPreStyle();
      writeCache([]);
      return;
    }

    let settled = false;
    const failsafe = setTimeout(() => {
      if (!settled) dropPreStyle(); // never let a hung request hide the page
    }, FAILSAFE_MS);

    try {
      const { data, error } = await c.from("home_content").select("key,is_visible");
      if (error || !data) throw error || new Error("no rows");

      const hiddenKeys = data.filter((row) => row.is_visible === false).map((row) => row.key);
      const hidden = new Set(hiddenKeys);
      writeCache(hiddenKeys);

      const admin = hidden.size ? await isAdmin(c) : false;
      apply(hidden, admin);
    } catch (e) {
      // Supabase unreachable, schema not migrated, RLS change — show everything.
      writeCache([]);
    } finally {
      settled = true;
      clearTimeout(failsafe);
      dropPreStyle();
    }
  }

  function ready(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }

  ready(load);
})();
