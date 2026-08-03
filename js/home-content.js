/* =========================================================
   home-content.js
   ---------------------------------------------------------
   Applies homepage, portfolio, and contact page text (plus
   the about-section photo) from Supabase's home_content
   table onto elements marked with data-field="section.field",
   data-field-href="section.field" (link destinations, e.g. the
   media kit PDF) or data-repeat="section.list".
   If Supabase isn't configured,
   or a section has no saved data yet, the baked-in Bangla text
   already in the HTML is left exactly as-is — the page never
   breaks or goes blank.

   The "stats" section is shared: the same stats.* fields are
   used on index.html (hero + trust bar), portfolio.html
   (performance snapshot), and contact.html (trust strip), so
   editing a stat once in the admin panel updates it everywhere.
   This file is the ONLY writer of those figures — the count-up
   animation that used to race it was removed from js/motion.js,
   because whichever finished last won and the displayed number
   changed from reload to reload.
   The footer tagline (data-field="footer.tagline") appears on
   every page, so this file is safe to include site-wide.
   ========================================================= */
(function () {
  "use strict";

  function escapeHtml(str) {
    return (str == null ? "" : String(str)).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  }

  function applyFields(content) {
    document.querySelectorAll("[data-field]").forEach((el) => {
      const [section, field] = el.getAttribute("data-field").split(".");
      const sectionData = content[section];
      if (!sectionData || sectionData[field] === undefined || sectionData[field] === "") return;
      const val = sectionData[field];
      if (el.tagName === "IMG") {
        el.src = val;
      } else {
        el.textContent = val;
      }
    });
  }

  /* data-field-href is deliberately separate from data-field: several
     buttons (hero.cta1/2/3, portfolio.cta1) already use data-field for
     their *label* while keeping a hard-coded href, so overloading the
     one attribute would break them. This handles the other case — an
     admin-uploaded file, currently the media kit PDF — where the link
     text is fixed and the destination is what the admin changes.
     Only http(s) and same-origin relative paths are honoured, so a
     bad row can't turn a download button into a javascript: URL. */
  function applyLinks(content) {
    document.querySelectorAll("[data-field-href]").forEach((el) => {
      const [section, field] = el.getAttribute("data-field-href").split(".");
      const sectionData = content[section];
      if (!sectionData || !sectionData[field]) return;
      const val = String(sectionData[field]).trim();
      if (!/^(https?:\/\/|\/|\.\/|[\w.-]+\/)/i.test(val)) return;
      el.href = val;
    });
  }

  const REPEAT_RENDERERS = {
    "about.paragraphs": (items) => items.map((p) => `<p>${escapeHtml(p)}</p>`).join(""),

    "about.timeline": (items) =>
      items.map((x) => `<div class="timeline-h-item"><span class="yr">${escapeHtml(x.year)}</span>${escapeHtml(x.text)}</div>`).join(""),

    "growth.items": (items) =>
      items.map((x, i) => `<div class="growth-item"><div class="growth-dot">${i + 1}</div><div class="g-mark">${escapeHtml(x.mark)}</div><h3>${escapeHtml(x.title)}</h3><p>${escapeHtml(x.desc)}</p></div>`).join(""),

    "testimonials.students": (items) => renderTestimonials(items),
    "testimonials.audience": (items) => renderTestimonials(items),

    "press.items": (items) =>
      items.map((x) => `<div class="press-item"><span class="p-logo">${escapeHtml(x.name)}</span><span class="p-cap">${escapeHtml(x.caption)}</span></div>`).join(""),

    "portfolio.campaigns": (items) =>
      items.map((x) => `<div class="bar" style="height:${escapeHtml(x.height)}%;"><span>${escapeHtml(x.value)}</span></div>`).join(""),

    "portfolio.audience_age": (items) =>
      items.map((x) => `<div class="audience-row"><span class="albl">${escapeHtml(x.label)}</span><div class="atrack"><div class="afill" style="width:${escapeHtml(x.percent)}%;"></div></div><span class="aval">${escapeHtml(x.percent)}%</span></div>`).join(""),

    "portfolio.partnership_types": (items) =>
      items.map((x) => `<div class="partner-card"><h3 style="font-size:1.05rem;">${escapeHtml(x.title)}</h3><p style="font-size:.88rem; margin-top:8px;">${escapeHtml(x.desc)}</p></div>`).join(""),

    "portfolio.collaborations": (items) =>
      items.map((x) => `<div class="case-card"><span class="case-type">${escapeHtml(x.type)}</span><span class="case-brand">${escapeHtml(x.brand)}</span><div class="case-result">${escapeHtml(x.result)}</div><div class="case-result-label">${escapeHtml(x.result_label)}</div><p class="case-desc">${escapeHtml(x.desc)}</p></div>`).join(""),
  };

  function renderTestimonials(items) {
    return items
      .map(
        (x) => `<div class="t-card"><p class="t-quote">"${escapeHtml(x.quote)}"</p><div class="t-person"><div class="t-avatar">${escapeHtml((x.name || "?").charAt(0))}</div><div><div class="t-name">${escapeHtml(x.name)}</div><div class="t-role">${escapeHtml(x.role)}</div></div></div></div>`
      )
      .join("");
  }

  function applyRepeats(content) {
    document.querySelectorAll("[data-repeat]").forEach((el) => {
      const key = el.getAttribute("data-repeat");
      const [section, field] = key.split(".");
      const sectionData = content[section];
      const items = sectionData ? sectionData[field] : null;
      if (!Array.isArray(items) || !items.length) return; // keep baked-in fallback content
      const renderer = REPEAT_RENDERERS[key];
      if (!renderer) return;
      el.innerHTML = renderer(items);
    });
  }

  async function load() {
    if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) return;
    if (typeof window.supabase === "undefined") return;
    if (!document.querySelector("[data-field], [data-repeat]")) return; // nothing on this page to fill in

    try {
      const client = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
      const { data, error } = await client.from("home_content").select("*");
      if (error || !data) return;
      const content = {};
      data.forEach((row) => { content[row.key] = row.value || {}; });
      applyFields(content);
      applyLinks(content);
      applyRepeats(content);
    } catch (e) {
      // never break the page over homepage content
    }
  }

  function ready(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }

  ready(load);
})();
