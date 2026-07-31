(async function () {
  "use strict";
  const admin = await Admin.requireAdmin();
  if (!admin) return;

  Admin.renderShell(
    "portfolio.html",
    "Portfolio & Stats",
    "The sponsor-facing Portfolio page, plus the shared numbers (subscribers, reach, rating, etc.) used across the homepage, portfolio page, and contact page.",
    admin
  );
  const content = document.getElementById("adminContent");
  content.innerHTML = `<div class="loading-row"><div class="spinner"></div> Loading portfolio content…</div>`;

  const c = Admin.client();
  const { data, error } = await c.from("home_content").select("*");
  if (error) {
    content.innerHTML = `<div class="notice">Couldn't load content: ${Admin.escapeHtml(error.message)}<br><br>
      Make sure you've run the latest <code>schema.sql</code> in the Supabase SQL editor — it adds the <code>stats</code> and <code>portfolio</code> rows.</div>`;
    return;
  }
  const HOME = {};
  (data || []).forEach((row) => { HOME[row.key] = row.value || {}; });
  const get = (section, field, fallback) => (HOME[section] && HOME[section][field] !== undefined ? HOME[section][field] : fallback || "");

  /* ---------- generic helpers (same pattern as admin-home.js) ---------- */
  function field(id, label, value, opts) {
    opts = opts || {};
    const openTag = opts.textarea
      ? `<textarea id="${id}">${Admin.escapeHtml(value)}</textarea>`
      : `<input type="text" id="${id}" value="${Admin.escapeHtml(value)}">`;
    return `<div class="form-field${opts.full ? " full" : ""}"><label>${label}</label>${openTag}</div>`;
  }

  function listWrap(id, addLabel) {
    return `<div id="${id}" class="list-editor" style="display:flex; flex-direction:column; gap:10px; margin-bottom:10px;"></div>
      <button type="button" class="btn btn-ghost btn-sm" data-add-list="${id}">${addLabel}</button>`;
  }

  function addListItem(containerId, schema, existing) {
    const wrap = document.getElementById(containerId);
    const el = document.createElement("div");
    el.className = "module-block";
    el.innerHTML = `
      <div class="module-head" style="align-items:flex-start;">
        <div style="flex:1; display:flex; flex-direction:column; gap:8px;">
          ${schema.map((f) => {
            const val = existing ? existing[f.key] || "" : "";
            return f.type === "textarea"
              ? `<textarea class="f-${f.key}" placeholder="${f.label}" style="background:var(--bg-3); border:1px solid var(--line-strong); border-radius:6px; padding:8px 10px; color:var(--text); min-height:44px;">${Admin.escapeHtml(val)}</textarea>`
              : `<input type="text" class="f-${f.key}" placeholder="${f.label}" value="${Admin.escapeHtml(val)}" style="background:var(--bg-3); border:1px solid var(--line-strong); border-radius:6px; padding:8px 10px; color:var(--text);">`;
          }).join("")}
        </div>
        <button type="button" class="icon-btn remove-item" title="Remove">✕</button>
      </div>`;
    wrap.appendChild(el);
    el.querySelector(".remove-item").addEventListener("click", () => el.remove());
  }

  function collectList(containerId, schema) {
    const wrap = document.getElementById(containerId);
    return Array.from(wrap.children)
      .map((el) => {
        const obj = {};
        schema.forEach((f) => { obj[f.key] = el.querySelector(`.f-${f.key}`).value.trim(); });
        return obj;
      })
      .filter((obj) => Object.values(obj).some((v) => v));
  }

  function wireAddButtons(scopeEl, configs) {
    scopeEl.querySelectorAll("[data-add-list]").forEach((btn) => {
      const id = btn.dataset.addList;
      if (!configs[id]) return;
      btn.addEventListener("click", () => addListItem(id, configs[id].schema));
    });
  }

  async function saveSection(key, value, btn) {
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = "Saving…";
    const { error: err } = await c.from("home_content").upsert({ key, value });
    btn.disabled = false;
    btn.textContent = original;
    if (err) { Admin.toast("Couldn't save: " + err.message, true); return; }
    Admin.toast("Saved — now live everywhere this value is used.");
  }

  function v(id) { return document.getElementById(id).value.trim(); }

  /* ---------- schemas for repeatable lists ---------- */
  const SCHEMA = {
    campaigns: [{ key: "value", label: "Value shown, e.g. 3.4M" }, { key: "height", label: "Bar height %, 0–100" }],
    audienceAge: [{ key: "label", label: "Age range, e.g. 25–34" }, { key: "percent", label: "Percent, e.g. 41" }],
    partnershipTypes: [{ key: "title", label: "Title" }, { key: "desc", label: "Description", type: "textarea" }],
    collaborations: [
      { key: "type", label: "Partnership type, e.g. Sponsored video" },
      { key: "brand", label: "Brand name" },
      { key: "result", label: "Headline result, e.g. 2.4M" },
      { key: "result_label", label: "Result caption, e.g. Views in 7 days" },
      { key: "desc", label: "Short description", type: "textarea" },
    ],
  };

  /* ---------- build the page ---------- */
  content.innerHTML = `
    <div class="notice" style="margin-bottom:20px;">
      The <strong>Shared Stats</strong> panel below feeds the homepage hero, the homepage trust bar, this portfolio page, and the
      contact page all at once — change a number here once and it updates in every one of those places.
    </div>

    <form class="panel" data-section="stats">
      <div class="panel-head"><div><h2>Shared Stats</h2><p>Used on: Home (hero + trust bar), Portfolio, and Contact.</p></div><button type="submit" class="btn btn-primary btn-sm">Save</button></div>
      <div class="form-grid">
        ${field("s_subv", "Subscribers — value", get("stats", "subscribers_value"))}${field("s_subl", "Subscribers — label", get("stats", "subscribers_label"))}
        ${field("s_mvv", "Monthly views — value", get("stats", "monthly_views_value"))}${field("s_mvl", "Monthly views — label", get("stats", "monthly_views_label"))}
        ${field("s_trv", "Total reach / YouTube views — value", get("stats", "total_reach_value"))}${field("s_trl", "Total reach / YouTube views — label", get("stats", "total_reach_label"))}
        ${field("s_whv", "Watch hours — value", get("stats", "watch_hours_value"))}${field("s_whl", "Watch hours — label", get("stats", "watch_hours_label"))}
        ${field("s_rav", "Rating — value", get("stats", "rating_value"))}${field("s_ral", "Rating — label", get("stats", "rating_label"))}
        ${field("s_stv", "Students — value", get("stats", "students_value"))}${field("s_stl", "Students — label", get("stats", "students_label"))}
        ${field("s_sav", "Satisfaction — value", get("stats", "satisfaction_value"))}${field("s_sal", "Satisfaction — label", get("stats", "satisfaction_label"))}
      </div>
      <p style="font-size:.8rem; color:var(--text-faint); margin:18px 0 8px;">Portfolio-only performance numbers (still shared with nothing else, but kept here since they're the same kind of stat):</p>
      <div class="form-grid">
        ${field("s_v30v", "30-day views — value", get("stats", "views_30d_value"))}${field("s_v30l", "30-day views — label", get("stats", "views_30d_label"))}
        ${field("s_v30t", "30-day views — trend note", get("stats", "views_30d_trend"), { full: true })}
        ${field("s_wtv", "Website traffic — value", get("stats", "website_traffic_value"))}${field("s_wtl", "Website traffic — label", get("stats", "website_traffic_label"))}
        ${field("s_wtt", "Website traffic — trend note", get("stats", "website_traffic_trend"), { full: true })}
        ${field("s_env", "Engagement rate — value", get("stats", "engagement_value"))}${field("s_enl", "Engagement rate — label", get("stats", "engagement_label"))}
        ${field("s_ent", "Engagement rate — trend note", get("stats", "engagement_trend"), { full: true })}
      </div>
    </form>

    <form class="panel" data-section="portfolio-hero">
      <div class="panel-head"><div><h2>Portfolio hero</h2><p>The banner at the top of the portfolio page.</p></div><button type="submit" class="btn btn-primary btn-sm">Save</button></div>
      <div class="form-grid">
        ${field("po_eyebrow", "Eyebrow text", get("portfolio", "eyebrow"))}
        ${field("po_title", "Title", get("portfolio", "title"), { full: true })}
        ${field("po_sub", "Subtitle", get("portfolio", "sub"), { textarea: true, full: true })}
        ${field("po_cta1", "Button 1 text (download kit)", get("portfolio", "cta1"))}
        ${field("po_cta2", "Button 2 text (scroll to partner options)", get("portfolio", "cta2"))}
      </div>
      <div class="form-field full">
        <label>Hero photo <span class="hint">optional — leave empty to keep the current photo</span></label>
        <input type="file" id="po_image" accept="image/*">
      </div>
    </form>

    <form class="panel" data-section="portfolio-glance">
      <div class="panel-head"><div><h2>Performance snapshot</h2><p>The 4-card stat row and campaign/audience charts.</p></div><button type="submit" class="btn btn-primary btn-sm">Save</button></div>
      <div class="form-grid">
        ${field("po_glance_title", "Section title", get("portfolio", "glance_title"), { full: true })}
        ${field("po_trtrend", "Total reach card — trend note (portfolio-only)", get("portfolio", "total_reach_trend"), { full: true })}
      </div>
      <div class="form-grid">
        ${field("po_camp_title", "Campaign chart title", get("portfolio", "campaigns_title"), { full: true })}
        ${field("po_camp_note", "Campaign chart note", get("portfolio", "campaign_note"), { textarea: true, full: true })}
      </div>
      <label style="font-size:.8rem; font-weight:600; color:var(--text-muted); display:block; margin-bottom:8px;">Campaign bars (last 5 sponsored campaigns)</label>
      ${listWrap("campaignsList", "+ Add campaign bar")}
      <div class="form-grid" style="margin-top:16px;">
        ${field("po_aud_title", "Audience section title", get("portfolio", "audience_title"), { full: true })}
      </div>
      <label style="font-size:.8rem; font-weight:600; color:var(--text-muted); display:block; margin-bottom:8px;">Audience age breakdown</label>
      ${listWrap("audienceList", "+ Add age group")}
      <div class="form-grid" style="margin-top:16px;">
        ${field("po_locations", "Top locations line", get("portfolio", "top_locations"), { textarea: true, full: true })}
        ${field("po_interests", "Top interests line", get("portfolio", "top_interests"), { textarea: true, full: true })}
      </div>
    </form>

    <form class="panel" data-section="portfolio-collab">
      <div class="panel-head"><div><h2>Past collaborations / case studies</h2><p>Shown to sponsors as proof of past results.</p></div><button type="submit" class="btn btn-primary btn-sm">Save</button></div>
      ${field("po_collab_title", "Section title", get("portfolio", "collaborations_title"), { full: true })}
      <label style="font-size:.8rem; font-weight:600; color:var(--text-muted); display:block; margin:12px 0 8px;">Case studies</label>
      ${listWrap("collabList", "+ Add case study")}
    </form>

    <form class="panel" data-section="portfolio-types">
      <div class="panel-head"><div><h2>Partnership types</h2></div><button type="submit" class="btn btn-primary btn-sm">Save</button></div>
      ${field("po_types_title", "Section title", get("portfolio", "types_title"), { full: true })}
      <label style="font-size:.8rem; font-weight:600; color:var(--text-muted); display:block; margin:12px 0 8px;">Types offered</label>
      ${listWrap("typesList", "+ Add partnership type")}
    </form>

    <form class="panel" data-section="portfolio-cta">
      <div class="panel-head"><div><h2>Bottom call-to-action</h2></div><button type="submit" class="btn btn-primary btn-sm">Save</button></div>
      <div class="form-grid">
        ${field("po_cta_title", "Title", get("portfolio", "cta_title"), { full: true })}
        ${field("po_cta_sub", "Subtitle", get("portfolio", "cta_sub"), { textarea: true, full: true })}
      </div>
    </form>`;

  /* ---------- populate list editors ---------- */
  (get("portfolio", "campaigns", [])).forEach((x) => addListItem("campaignsList", SCHEMA.campaigns, x));
  (get("portfolio", "audience_age", [])).forEach((x) => addListItem("audienceList", SCHEMA.audienceAge, x));
  (get("portfolio", "collaborations", [])).forEach((x) => addListItem("collabList", SCHEMA.collaborations, x));
  (get("portfolio", "partnership_types", [])).forEach((x) => addListItem("typesList", SCHEMA.partnershipTypes, x));

  /* ---------- wire "+ Add" buttons ---------- */
  wireAddButtons(content, {
    campaignsList: { schema: SCHEMA.campaigns },
    audienceList: { schema: SCHEMA.audienceAge },
    collabList: { schema: SCHEMA.collaborations },
    typesList: { schema: SCHEMA.partnershipTypes },
  });

  /* ---------- helper to merge partial updates into the existing 'portfolio' row ---------- */
  function savePortfolioPatch(patch, btn) {
    const merged = Object.assign({}, HOME.portfolio || {}, patch);
    HOME.portfolio = merged;
    saveSection("portfolio", merged, btn);
  }

  /* ---------- wire section save handlers ---------- */
  content.querySelector('[data-section="stats"]').addEventListener("submit", (e) => {
    e.preventDefault();
    const value = {
      subscribers_value: v("s_subv"), subscribers_label: v("s_subl"),
      monthly_views_value: v("s_mvv"), monthly_views_label: v("s_mvl"),
      total_reach_value: v("s_trv"), total_reach_label: v("s_trl"),
      watch_hours_value: v("s_whv"), watch_hours_label: v("s_whl"),
      rating_value: v("s_rav"), rating_label: v("s_ral"),
      students_value: v("s_stv"), students_label: v("s_stl"),
      satisfaction_value: v("s_sav"), satisfaction_label: v("s_sal"),
      views_30d_value: v("s_v30v"), views_30d_label: v("s_v30l"), views_30d_trend: v("s_v30t"),
      website_traffic_value: v("s_wtv"), website_traffic_label: v("s_wtl"), website_traffic_trend: v("s_wtt"),
      engagement_value: v("s_env"), engagement_label: v("s_enl"), engagement_trend: v("s_ent"),
    };
    saveSection("stats", value, e.submitter);
  });

  content.querySelector('[data-section="portfolio-hero"]').addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.submitter;
    const fileInput = document.getElementById("po_image");
    let image_url = get("portfolio", "image_url", "");
    if (fileInput.files[0]) {
      btn.disabled = true;
      const original = btn.textContent;
      btn.textContent = "Uploading…";
      try {
        image_url = await Admin.uploadImage(fileInput.files[0], "home");
      } catch (err) {
        Admin.toast("Couldn't upload the photo: " + (err.message || err), true);
        btn.disabled = false;
        btn.textContent = original;
        return;
      }
      btn.disabled = false;
      btn.textContent = original;
    }
    savePortfolioPatch({
      eyebrow: v("po_eyebrow"), title: v("po_title"), sub: v("po_sub"),
      cta1: v("po_cta1"), cta2: v("po_cta2"), image_url,
    }, btn);
  });

  content.querySelector('[data-section="portfolio-glance"]').addEventListener("submit", (e) => {
    e.preventDefault();
    savePortfolioPatch({
      glance_title: v("po_glance_title"),
      total_reach_trend: v("po_trtrend"),
      campaigns_title: v("po_camp_title"),
      campaign_note: v("po_camp_note"),
      campaigns: collectList("campaignsList", SCHEMA.campaigns),
      audience_title: v("po_aud_title"),
      audience_age: collectList("audienceList", SCHEMA.audienceAge),
      top_locations: v("po_locations"),
      top_interests: v("po_interests"),
    }, e.submitter);
  });

  content.querySelector('[data-section="portfolio-collab"]').addEventListener("submit", (e) => {
    e.preventDefault();
    savePortfolioPatch({
      collaborations_title: v("po_collab_title"),
      collaborations: collectList("collabList", SCHEMA.collaborations),
    }, e.submitter);
  });

  content.querySelector('[data-section="portfolio-types"]').addEventListener("submit", (e) => {
    e.preventDefault();
    savePortfolioPatch({
      types_title: v("po_types_title"),
      partnership_types: collectList("typesList", SCHEMA.partnershipTypes),
    }, e.submitter);
  });

  content.querySelector('[data-section="portfolio-cta"]').addEventListener("submit", (e) => {
    e.preventDefault();
    savePortfolioPatch({ cta_title: v("po_cta_title"), cta_sub: v("po_cta_sub") }, e.submitter);
  });
})();
