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

  /* Bangla first, English only as a fallback. These used to read
     `title_en || title_bn`, so any course with an English title filled in
     displayed in English on a Bangla-only site — and since the admin form
     used to *require* the English field, that was every course. The _bn/_en
     copies are kept alongside for anything that wants a specific language. */
  function mapCourse(row) {
    return {
      id: row.slug,
      dbId: row.id,
      title: row.title_bn || row.title_en,
      title_bn: row.title_bn,
      title_en: row.title_en,
      price: row.price_bdt,
      free: row.is_free,
      duration: row.duration_bn || row.duration_en || "",
      rating: Number(row.rating) || 4.8,
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
      /* What a buyer receives. delivery_type/label are public so the product
         page can say what you get; delivery_url arrives as null from
         products_safe unless this visitor has actually bought it. */
      deliveryType: row.delivery_type || "none",
      deliveryLabel: row.delivery_label || "",
      deliveryUrl: row.delivery_url || null,
      deliveryNote: row.delivery_note || "",
    };
  }

  async function tryLoadFromSupabase() {
    if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) return false;
    if (typeof window.supabase === "undefined") return false;

    try {
      const client = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

      const [coursesRes, productsRes] = await Promise.all([
        client.from("courses_safe").select("*").order("sort_order", { ascending: true }),
        // products_safe, not products: the raw table would hand every visitor
        // the digital delivery URL whether or not they paid for it.
        client.from("products_safe").select("*").eq("is_published", true).order("sort_order", { ascending: true }),
      ]);

      /* Handled independently on purpose. These used to share one failure
         check, so a problem with the products query threw the courses away
         too and the whole site dropped to the English sample data. A missing
         products_safe view should cost you the store, not the catalogue. */
      if (coursesRes.error) {
        console.warn("Shahedin: couldn't load courses, using sample data.", coursesRes.error);
      }
      if (productsRes.error) {
        console.warn(
          "Shahedin: couldn't load products, using sample data. If this says products_safe " +
          "does not exist, run section 19 of schema.sql in the Supabase SQL editor.",
          productsRes.error
        );
      }

      const courses = coursesRes.error ? [] : (coursesRes.data || []).map(mapCourse);
      const products = productsRes.error ? [] : (productsRes.data || []).map(mapProduct);

      // Only replace the sample data if Supabase actually returned rows —
      // an empty database shouldn't blank out the demo content.
      window.SITE_DATA = window.SITE_DATA || {};
      if (courses.length) window.SITE_DATA.courses = courses;
      if (products.length) window.SITE_DATA.products = products;
      return !(coursesRes.error && productsRes.error);
    } catch (err) {
      console.warn("Shahedin: Supabase fetch threw an error, using sample data.", err);
      return false;
    }
  }

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
