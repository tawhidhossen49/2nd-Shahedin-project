/* =========================================================
   data-loader.js
   ---------------------------------------------------------
   If js/supabase-config.js has been filled in, this replaces
   window.SITE_DATA (originally set by js/data.js) with live
   content from Supabase, so anything the admin panel adds,
   edits, or removes shows up on the public site automatically.

   If Supabase isn't configured yet, or the request fails for
   any reason (offline, wrong keys, etc), the site silently
   keeps using the sample content from js/data.js — the site
   never breaks because of this file.
   ========================================================= */
(function () {
  "use strict";

  function mapCourse(row) {
    return {
      id: row.slug,
      dbId: row.id,
      // Bangla-first: the site is lang="bn", so the Bangla column leads and
      // English is the fallback. This was the other way round, which is why an
      // admin-created course showed its English title to every visitor.
      title: row.title_bn || row.title_en,
      title_bn: row.title_bn,
      title_en: row.title_en,
      price: row.price_bdt,
      free: row.is_free,
      duration: row.duration_bn || row.duration_en || "",
      /* Pass a missing rating through as null. It used to default to 4.8,
         so a brand-new course with no reviews displayed a fabricated ৪.৮
         and five stars. render.js shows "নতুন" for null instead. */
      rating: row.rating === null || row.rating === undefined || row.rating === "" ? null : Number(row.rating),
      students: row.students_count || 0,
      tone: row.tone || 1,
      category: row.category || "general",
      desc: row.description_bn || row.description_en || "",
      image: row.thumbnail_url || null,
      modules: Array.isArray(row.modules) ? row.modules.map(mapModule) : [],
      contentBlocks: Array.isArray(row.content_blocks) ? row.content_blocks : [],
      includes: Array.isArray(row.includes) ? row.includes : [],
      faqs: Array.isArray(row.faqs) ? row.faqs : [],
      mentor: row.mentor && typeof row.mentor === "object" ? row.mentor : {},
    };
  }

  function mapModule(m) {
    return {
      title: m.title,
      lessons: Array.isArray(m.lessons)
        ? m.lessons.map((l) => [l.title, l.length, !!l.preview])
        : [],
    };
  }

  function mapProduct(row) {
    return {
      id: row.slug,
      dbId: row.id,
      title: row.name_bn || row.name_en,
      title_bn: row.name_bn,
      title_en: row.name_en,
      type: row.type || "digital",
      price: row.price_bdt,
      oldPrice: row.old_price_bdt || undefined,
      tone: row.tone || 1,
      category: row.category || "notes",
      desc: row.description_bn || row.description_en || "",
      image: row.image_url || null,
      stock: row.stock,
    };
  }

  async function tryLoadFromSupabase() {
    if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) return false;
    if (typeof window.supabase === "undefined") return false;

    try {
      const client = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

      const [coursesRes, productsRes] = await Promise.all([
        client.from("courses_safe").select("*").order("sort_order", { ascending: true }),
        client.from("products").select("*").eq("is_published", true).order("sort_order", { ascending: true }),
      ]);

      if (coursesRes.error || productsRes.error) {
        console.warn("Shahedin: Supabase fetch failed, using sample data.", coursesRes.error || productsRes.error);
        return false;
      }

      const courses = (coursesRes.data || []).map(mapCourse);
      const products = (productsRes.data || []).map(mapProduct);

      // Only replace the sample data if Supabase actually returned rows —
      // an empty database shouldn't blank out the demo content.
      window.SITE_DATA = window.SITE_DATA || {};
      if (courses.length) window.SITE_DATA.courses = courses;
      if (products.length) window.SITE_DATA.products = products;
      return true;
    } catch (err) {
      console.warn("Shahedin: Supabase fetch threw an error, using sample data.", err);
      return false;
    }
  }

  /* Exposed so js/render.js can re-pull courses_safe after a student enrols.
     Until enrolment, that view returns every block as {id,type,title,locked},
     so without a re-fetch the player stays padlocked until a manual reload. */
  window.ShahedinData = { reload: tryLoadFromSupabase };

  function ready(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }

  ready(function () {
    // Race the Supabase load against a short timeout so a slow/unreachable
    // network never leaves the page stuck without content.
    Promise.race([
      tryLoadFromSupabase(),
      new Promise((resolve) => setTimeout(() => resolve(false), 4000)),
    ]).finally(() => {
      document.dispatchEvent(new Event("sitedata-ready"));
    });
  });
})();
