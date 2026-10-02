/* =========================================================
   data-loader.js
   ---------------------------------------------------------
   Fills window.SITE_DATA (the empty shape set by js/data.js)
   with live content from Supabase, so anything the admin panel
   adds, edits, or removes shows up on the public site.

   There is no sample content to fall back to. A table with no
   rows renders as an empty state. A table that could not be
   loaded, after the retries below, is marked in
   SITE_DATA.failed and renders as "couldn't load, try again".
   Either way a visitor never sees a course or product that is
   not in the database.
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
      /* Whether the course page shows its reviews block at all. Anything other
         than an explicit false counts as on, so a database still missing the
         column (section 23 of schema.sql) keeps showing reviews as before. */
      reviewsEnabled: row.reviews_enabled !== false,
      /* Same shape, same reason: an older database missing the column
         (section 24 of schema.sql) keeps showing the count as before. */
      showStudents: row.show_students_count !== false,
      /* The "what you'll learn" block. An empty array means the section is
         not rendered at all, which is how every existing course stays
         exactly as it is until someone adds a point to it. */
      learnTitle: row.learn_title || "",
      learnPoints: Array.isArray(row.learn_points) ? row.learn_points : [],
      // Blank = no trailer, and the hero renders as it always has.
      previewVideoUrl: row.preview_video_url || "",
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

  /* render.js has a timer that renders without waiting, for a page that does
     not include this file. This tells it a loader is present and it must wait
     for "sitedata-ready" however long that takes. */
  window.__shahedinDataLoader = true;

  const ATTEMPTS = 3;
  const ATTEMPT_MS = 8000;

  const QUERIES = {
    courses: (client) => client.from("courses_safe").select("*").order("sort_order", { ascending: true }),
    // products_safe, not products: the raw table would hand every visitor
    // the digital delivery URL whether or not they paid for it.
    products: (client) => client.from("products_safe").select("*").eq("is_published", true).order("sort_order", { ascending: true }),
  };
  const MAPPERS = { courses: mapCourse, products: mapProduct };

  // One query, never rejecting and never hanging: a thrown error or a request
  // still open after ATTEMPT_MS both come back as { error }.
  function runQuery(client, key) {
    const query = Promise.resolve()
      .then(() => QUERIES[key](client))
      .catch((err) => ({ error: err }));
    const timeout = new Promise((resolve) =>
      setTimeout(() => resolve({ error: { message: "timed out after " + ATTEMPT_MS + "ms" } }), ATTEMPT_MS)
    );
    return Promise.race([query, timeout]);
  }

  async function loadSiteData() {
    const data = (window.SITE_DATA = window.SITE_DATA || {});
    data.courses = [];
    data.products = [];
    data.failed = { courses: false, products: false };

    // No keys: nothing to load, and the pages show their empty states.
    if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) return;

    let client = null;
    try {
      // Undefined when the Supabase script itself failed to download.
      client = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
    } catch (err) {
      console.warn("Shahedin: Supabase client unavailable.", err);
      data.failed = { courses: true, products: true };
      return;
    }

    /* The two tables are loaded and retried independently, so a problem with
       one never costs the other. A slow mobile connection gets up to three
       tries before the page says it could not load. */
    let pending = Object.keys(QUERIES);
    for (let attempt = 0; attempt < ATTEMPTS && pending.length; attempt++) {
      if (attempt) await new Promise((resolve) => setTimeout(resolve, 700));
      const results = await Promise.all(pending.map((key) => runQuery(client, key)));
      const retry = [];
      pending.forEach((key, i) => {
        const res = results[i];
        if (res && !res.error) {
          data[key] = (res.data || []).map(MAPPERS[key]);
        } else {
          console.warn("Shahedin: couldn't load " + key + " (try " + (attempt + 1) + " of " + ATTEMPTS + ").", res && res.error);
          retry.push(key);
        }
      });
      pending = retry;
    }
    pending.forEach((key) => { data.failed[key] = true; });
  }

  function ready(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }

  ready(function () {
    loadSiteData()
      .catch((err) => {
        console.warn("Shahedin: loading site data threw.", err);
        const data = (window.SITE_DATA = window.SITE_DATA || {});
        data.courses = data.courses || [];
        data.products = data.products || [];
        data.failed = { courses: true, products: true };
      })
      .finally(() => {
        document.dispatchEvent(new Event("sitedata-ready"));
      });
  });
})();
