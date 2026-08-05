/* =========================================================
   admin-legal.js
   ---------------------------------------------------------
   Editor for the Terms of Service and Privacy Policy pages.

   Stored in site_settings under the key "legal" — a jsonb
   key/value store that already exists, so this feature needs
   no migration. Public read, admin-only write.

   The preview pane renders through window.ShahedinLegal.render,
   the exact function terms.html and privacy.html use. Writing
   a second renderer for the preview would eventually drift and
   the admin would be editing blind.
   ========================================================= */
(async function () {
  "use strict";
  const admin = await Admin.requireAdmin();
  if (!admin) return;

  Admin.renderShell(
    "legal.html",
    "Terms & Privacy",
    "The two legal pages on the public site. Everything here is editable, and changes go live immediately.",
    admin
  );
  const content = document.getElementById("adminContent");
  content.innerHTML = `<div class="loading-row"><div class="spinner"></div> Loading…</div>`;

  const c = Admin.client();
  const DEFAULTS = window.SHAHEDIN_LEGAL_DEFAULTS || { terms: {}, privacy: {} };

  const PAGES = [
    { id: "terms", label: "Terms of Service", file: "terms.html" },
    { id: "privacy", label: "Privacy Policy", file: "privacy.html" },
  ];

  let saved = {};

  const { data, error } = await c.from("site_settings").select("value").eq("key", "legal").maybeSingle();
  if (error) {
    content.innerHTML = `<div class="notice">Couldn't load: ${Admin.escapeHtml(error.message)}</div>`;
    return;
  }
  saved = (data && data.value) || {};

  // A field falls back to the starter text, so the editor always opens showing
  // exactly what visitors are currently being served — never an empty box that
  // could be saved over real content by accident.
  const val = (page, key) => {
    const v = saved[page + "_" + key];
    return (v === undefined || v === null || v === "") ? (DEFAULTS[page] || {})[key] || "" : v;
  };

  content.innerHTML = `
    <div class="notice" style="margin-bottom:20px;">
      <strong>These are a starting point, not legal advice.</strong><br><br>
      The text was written to describe what this site actually does (phone-number accounts,
      Supabase storage, bKash payments, cookie-free analytics), so it is honest rather than
      generic. It has <em>not</em> been reviewed by a lawyer. Have someone qualified check it
      before you rely on it, particularly the refund terms and anything about personal data.
    </div>

    <div class="panel">
      <div class="panel-head">
        <div><h2>Formatting</h2><p>The body box understands a few simple marks. Everything else is plain text.</p></div>
      </div>
      <table class="admin-table">
        <thead><tr><th>Type this</th><th>Get this</th></tr></thead>
        <tbody>
          <tr><td><code>## Heading</code></td><td>A section heading</td></tr>
          <tr><td><code>### Smaller heading</code></td><td>A sub-heading</td></tr>
          <tr><td><code>- item</code></td><td>A bullet list</td></tr>
          <tr><td><code>1. item</code></td><td>A numbered list</td></tr>
          <tr><td><code>**important**</code></td><td>Bold text</td></tr>
          <tr><td><code>[যোগাযোগ](contact.html)</code></td><td>A link</td></tr>
          <tr><td>A blank line</td><td>Starts a new paragraph</td></tr>
        </tbody>
      </table>
    </div>

    ${PAGES.map((p) => `
      <form class="panel" data-page="${p.id}">
        <div class="panel-head">
          <div>
            <h2>${p.label}</h2>
            <p>Live at <a href="../${p.file}" target="_blank" rel="noopener">/${p.file}</a></p>
          </div>
          <button type="submit" class="btn btn-primary btn-sm">Save</button>
        </div>
        <div class="form-grid">
          <div class="form-field">
            <label for="${p.id}_title">Page title</label>
            <input type="text" id="${p.id}_title" value="${Admin.escapeHtml(val(p.id, "title"))}">
          </div>
          <div class="form-field">
            <label for="${p.id}_updated">"Last updated" date <span class="hint">shown under the title</span></label>
            <input type="text" id="${p.id}_updated" value="${Admin.escapeHtml(val(p.id, "updated"))}" placeholder="৬ আগস্ট ২০২৬">
          </div>
          <div class="form-field full">
            <label for="${p.id}_intro">Intro line</label>
            <input type="text" id="${p.id}_intro" value="${Admin.escapeHtml(val(p.id, "intro"))}">
          </div>
          <div class="form-field full">
            <label for="${p.id}_body">Body</label>
            <textarea id="${p.id}_body" rows="18" spellcheck="false"
              style="min-height:340px; font-family:var(--font-mono,monospace); font-size:.84rem; line-height:1.7;">${Admin.escapeHtml(val(p.id, "body"))}</textarea>
          </div>
          <div class="form-field full">
            <label>Preview <span class="hint">exactly how the public page will render it</span></label>
            <div class="legal-preview" id="${p.id}_preview"></div>
          </div>
        </div>
        <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
          <button type="button" class="btn btn-ghost btn-sm" data-reset="${p.id}">Reset to the built-in text</button>
          <span class="hint">Replaces what is in the boxes above. Nothing is saved until you press Save.</span>
        </div>
      </form>`).join("")}`;

  PAGES.forEach((p) => {
    const form = content.querySelector(`[data-page="${p.id}"]`);
    const bodyEl = document.getElementById(`${p.id}_body`);
    const previewEl = document.getElementById(`${p.id}_preview`);

    const repaint = () => { previewEl.innerHTML = window.ShahedinLegal.render(bodyEl.value); };
    bodyEl.addEventListener("input", repaint);
    repaint();

    form.querySelector(`[data-reset="${p.id}"]`).addEventListener("click", () => {
      if (!confirm(`Put the built-in ${p.label} text back into the boxes? Anything you have typed here will be replaced.`)) return;
      const d = DEFAULTS[p.id] || {};
      document.getElementById(`${p.id}_title`).value = d.title || "";
      document.getElementById(`${p.id}_updated`).value = d.updated || "";
      document.getElementById(`${p.id}_intro`).value = d.intro || "";
      bodyEl.value = d.body || "";
      repaint();
      Admin.toast("Built-in text restored. Press Save to publish it.");
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = e.submitter;
      const body = bodyEl.value.trim();

      // An empty body would publish a blank legal page, which is worse than an
      // imperfect one. Blocked outright.
      if (!body) {
        Admin.showFieldError(bodyEl, "The body can't be empty. Use “Reset to the built-in text” if you want to start over.");
        Admin.toast("Body is empty.", true);
        return;
      }

      const original = btn.textContent;
      btn.disabled = true;
      btn.textContent = "Saving…";

      // Merged, so saving Terms never wipes Privacy out of the same row.
      const merged = Object.assign({}, saved, {
        [`${p.id}_title`]: document.getElementById(`${p.id}_title`).value.trim(),
        [`${p.id}_updated`]: document.getElementById(`${p.id}_updated`).value.trim(),
        [`${p.id}_intro`]: document.getElementById(`${p.id}_intro`).value.trim(),
        [`${p.id}_body`]: body,
      });

      const { error: err } = await c.from("site_settings").upsert({ key: "legal", value: merged });
      btn.disabled = false;
      btn.textContent = original;

      if (err) { Admin.toast("Couldn't save: " + err.message, true); return; }
      saved = merged;
      Admin.clearFieldErrors(form);
      Admin.toast(`${p.label} saved and live.`);
    });
  });
})();
