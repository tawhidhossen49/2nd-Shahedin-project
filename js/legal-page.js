/* =========================================================
   legal-page.js
   ---------------------------------------------------------
   Renders terms.html and privacy.html from Supabase
   (site_settings, key "legal"), falling back to the starter
   text in js/legal-defaults.js when nothing has been saved.
   Same contract as the rest of the site: the page never
   renders empty and never depends on the network.

   Exposes window.ShahedinLegal.render(text) so the admin
   panel's live preview uses this exact renderer. If the
   preview and the public page ever drift, the admin is
   editing blind.

   SAFETY: the body is escaped FIRST, then our own markers are
   converted back into tags. Nothing the admin types can inject
   markup, even by accident, and a stray "<" in a policy is
   shown as a "<" rather than swallowing the rest of the page.
   ========================================================= */
window.ShahedinLegal = (function () {
  "use strict";

  function escapeHtml(str) {
    return (str == null ? "" : String(str)).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  }

  /* Inline markers, applied to text that is ALREADY escaped.
     Links are restricted to http(s), mailto: and same-site .html pages so a
     policy can never carry a javascript: URL. */
  function inline(safeText) {
    return safeText
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label, href) => {
        const ok = /^(https?:\/\/|mailto:|tel:)/i.test(href) || /^[\w.-]+\.html(#[\w-]+)?$/i.test(href);
        if (!ok) return label;
        const external = /^https?:\/\//i.test(href);
        return `<a href="${href}"${external ? ' target="_blank" rel="noopener"' : ""}>${label}</a>`;
      });
  }

  function render(text) {
    const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
    const out = [];
    let list = null; // "ul" | "ol" | null
    let para = [];

    const flushPara = () => {
      if (!para.length) return;
      out.push(`<p>${inline(para.join(" "))}</p>`);
      para = [];
    };
    const flushList = () => {
      if (!list) return;
      out.push(`</${list}>`);
      list = null;
    };

    lines.forEach((raw) => {
      const line = escapeHtml(raw.trim());

      if (!line) { flushPara(); flushList(); return; }

      const h3 = line.match(/^###\s+(.*)$/);
      const h2 = line.match(/^##\s+(.*)$/);
      if (h2 || h3) {
        flushPara(); flushList();
        out.push(h3 ? `<h3>${inline(h3[1])}</h3>` : `<h2>${inline(h2[1])}</h2>`);
        return;
      }

      const bullet = line.match(/^[-*]\s+(.*)$/);
      const numbered = line.match(/^\d+\.\s+(.*)$/);
      if (bullet || numbered) {
        flushPara();
        const want = bullet ? "ul" : "ol";
        if (list !== want) { flushList(); out.push(`<${want}>`); list = want; }
        out.push(`<li>${inline((bullet || numbered)[1])}</li>`);
        return;
      }

      flushList();
      para.push(line);
    });

    flushPara();
    flushList();
    return out.join("");
  }

  function paint(kind, data) {
    const defaults = (window.SHAHEDIN_LEGAL_DEFAULTS || {})[kind] || {};
    const value = (key) => {
      const saved = data && String(data[kind + "_" + key] || "").trim();
      return saved || defaults[key] || "";
    };

    // querySelectorAll, not querySelector: the title appears twice on the
    // page (breadcrumb and <h1>) and both have to track the saved value.
    const setText = (sel, text) => {
      document.querySelectorAll(sel).forEach((el) => { el.textContent = text; });
    };
    setText("[data-legal-title]", value("title"));
    setText("[data-legal-intro]", value("intro"));

    const updatedEl = document.querySelector("[data-legal-updated]");
    if (updatedEl) {
      const when = value("updated");
      updatedEl.textContent = when ? `সর্বশেষ হালনাগাদ: ${when}` : "";
      updatedEl.hidden = !when;
    }

    const body = document.querySelector("[data-legal-body]");
    if (body) body.innerHTML = render(value("body"));

    document.title = `${value("title")} — Shahedin`;
  }

  async function load() {
    const mount = document.querySelector("[data-legal-page]");
    if (!mount) return;
    const kind = mount.getAttribute("data-legal-page"); // "terms" | "privacy"

    // Paint the built-in text immediately, then upgrade if Supabase has an
    // edited version. The page is readable before the network answers.
    paint(kind, null);

    if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) return;
    if (typeof window.supabase === "undefined") return;
    try {
      const client = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
      const { data, error } = await client.from("site_settings").select("value").eq("key", "legal").maybeSingle();
      if (error || !data || !data.value) return;
      paint(kind, data.value);
    } catch (e) {
      // Keep the built-in text; a legal page must never go blank.
    }
  }

  if (document.readyState !== "loading") load();
  else document.addEventListener("DOMContentLoaded", load);

  return { render };
})();
