(async function () {
  "use strict";
  const admin = await Admin.requireAdmin();
  if (!admin) return;

  Admin.renderShell("home.html", "Homepage Content", "Every piece of text and photo on the homepage, plus which sections the public can see. Save each section separately — changes go live immediately.", admin);
  const content = document.getElementById("adminContent");
  content.innerHTML = `<div class="loading-row"><div class="spinner"></div> Loading homepage content…</div>`;

  const c = Admin.client();
  const { data, error } = await c.from("home_content").select("*");
  if (error) {
    content.innerHTML = `<div class="notice">Couldn't load homepage content: ${Admin.escapeHtml(error.message)}<br><br>
      Make sure you've run the latest <code>schema.sql</code> in the Supabase SQL editor — it adds the <code>home_content</code> table.</div>`;
    return;
  }
  const HOME = {};
  const VISIBLE = {};
  (data || []).forEach((row) => {
    HOME[row.key] = row.value || {};
    VISIBLE[row.key] = row.is_visible !== false; // missing column (older schema) reads as visible
  });
  const get = (section, field, fallback) => (HOME[section] && HOME[section][field] !== undefined ? HOME[section][field] : fallback || "");

  /* ---------- Sections that can be hidden from the public ----------
     Each key must match a <section data-section-key="..."> in the public
     HTML *and* a row in home_content (schema.sql seeds a row for the
     layout-only ones, e.g. the trust bar). */
  const SECTION_TOGGLES = [
    { key: "hero", page: "Homepage", label: "Hero", note: "Headline, buttons, photo and the 4 stat numbers." },
    { key: "trust_bar", page: "Homepage", label: "Trust bar", note: "The 4-stat strip right under the hero." },
    { key: "about", page: "Homepage", label: "About Shahedin", note: "Story, photo and timeline." },
    { key: "videos", page: "Homepage", label: "Featured videos", note: "Latest YouTube uploads + social links." },
    { key: "featured_courses", page: "Homepage", label: "Featured courses" },
    { key: "growth", page: "Homepage", label: "Journey timeline" },
    { key: "testimonials", page: "Homepage", label: "Testimonials" },
    { key: "press", page: "Home + Portfolio", label: "Press & appearances", note: "Appears on both pages — hiding it hides both." },
    { key: "portfolio_hero", page: "Portfolio", label: "Portfolio hero" },
    { key: "portfolio_glance", page: "Portfolio", label: "Performance snapshot" },
    { key: "portfolio_collaborations", page: "Portfolio", label: "Past collaborations" },
    { key: "portfolio_types", page: "Portfolio", label: "Partnership types + bottom CTA" },
  ];

  /* ---------- generic helpers ---------- */
  function field(id, label, value, opts) {
    opts = opts || {};
    const tag = opts.textarea ? "textarea" : "input";
    const openTag = opts.textarea
      ? `<textarea id="${id}" ${opts.full ? "" : ""}>${Admin.escapeHtml(value)}</textarea>`
      : `<input type="text" id="${id}" value="${Admin.escapeHtml(value)}">`;
    return `<div class="form-field${opts.full ? " full" : ""}"><label>${label}</label>${openTag}</div>`;
  }

  function listWrap(id, addLabel) {
    return `<div id="${id}" class="list-editor" style="display:flex; flex-direction:column; gap:10px; margin-bottom:10px;"></div>
      <button type="button" class="btn btn-ghost btn-sm" data-add-list="${id}">${addLabel}</button>`;
  }

  // schema: [{key,label,type:'text'|'textarea'}], or {plain:true, label} for a bare string list
  function addListItem(containerId, schema, existing) {
    const wrap = document.getElementById(containerId);
    const el = document.createElement("div");
    el.className = "module-block";
    if (schema.plain) {
      el.innerHTML = `
        <div class="module-head">
          <textarea class="f-value" placeholder="${schema.label}" style="flex:1; background:var(--bg-3); border:1px solid var(--line-strong); border-radius:6px; padding:8px 10px; color:var(--text); min-height:50px;">${Admin.escapeHtml(existing || "")}</textarea>
          <button type="button" class="icon-btn remove-item" title="Remove">✕</button>
        </div>`;
    } else {
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
    }
    wrap.appendChild(el);
    el.querySelector(".remove-item").addEventListener("click", () => el.remove());
  }

  function collectList(containerId, schema) {
    const wrap = document.getElementById(containerId);
    const cards = Array.from(wrap.children);
    if (schema.plain) {
      return cards.map((el) => el.querySelector(".f-value").value.trim()).filter((v) => v);
    }
    return cards
      .map((el) => {
        const obj = {};
        schema.forEach((f) => { obj[f.key] = el.querySelector(`.f-${f.key}`).value.trim(); });
        return obj;
      })
      .filter((obj) => Object.values(obj).some((v) => v));
  }

  function wireAddButtons(scopeEl, configs) {
    // configs: { [containerId]: { schema, factory } }
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
    Admin.toast("Saved — now live on the homepage.");
  }

  /* ---------- schemas for repeatable lists ---------- */
  const SCHEMA = {
    aboutParagraphs: { plain: true, label: "Paragraph text" },
    aboutTimeline: [{ key: "year", label: "Year" }, { key: "text", label: "Text" }],
    growthItems: [{ key: "mark", label: "Small label, e.g. 2018 · Idea Phase" }, { key: "title", label: "Title" }, { key: "desc", label: "Description", type: "textarea" }],
    testimonialItem: [{ key: "quote", label: "Quote", type: "textarea" }, { key: "name", label: "Name" }, { key: "role", label: "Role / context" }],
    pressItems: [{ key: "name", label: "Outlet / organization name" }, { key: "caption", label: "Caption, e.g. Feature interview, 2025" }],
  };

  /* ---------- build the page ---------- */
  content.innerHTML = `
    <div class="notice" style="margin-bottom:20px;">
      Looking for the hero/trust-bar <strong>numbers</strong> (subscribers, views, reach, rating, etc.)? Those now live on the
      <a href="portfolio.html" style="color:var(--accent-2); text-decoration:underline;">Portfolio &amp; Stats</a> page, since the same
      numbers are shared across the homepage, portfolio page, and contact page — edit them once there and they update everywhere.
    </div>
    <form class="panel" data-section="visibility">
      <div class="panel-head">
        <div><h2>Section visibility</h2><p>Turn a section off to hide it from visitors — nothing is deleted, and you'll still see it yourself while logged in here, marked as hidden. Needs the latest <code>schema.sql</code>.</p></div>
        <button type="submit" class="btn btn-primary btn-sm">Save</button>
      </div>
      <div class="visibility-list">
        ${SECTION_TOGGLES.map(
          (s) => `<label class="visibility-row">
            <span class="visibility-info">
              <span class="visibility-label">${Admin.escapeHtml(s.label)}<span class="visibility-page">${Admin.escapeHtml(s.page)}</span></span>
              ${s.note ? `<span class="visibility-note">${Admin.escapeHtml(s.note)}</span>` : ""}
            </span>
            <span class="switch"><input type="checkbox" data-visibility="${s.key}"${VISIBLE[s.key] === false ? "" : " checked"}><span class="switch-track"></span></span>
          </label>`
        ).join("")}
      </div>
    </form>

    <form class="panel" data-section="hero">
      <div class="panel-head"><div><h2>Hero</h2><p>The big banner at the very top of the homepage.</p></div><button type="submit" class="btn btn-primary btn-sm">Save</button></div>
      <div class="form-grid">
        ${field("h_eyebrow", "Eyebrow text", get("hero", "eyebrow"))}
        ${field("h_title", "Title", get("hero", "title"))}
        ${field("h_sub", "Subtitle", get("hero", "sub"), { textarea: true, full: true })}
        ${field("h_cta2", "Button 1 text (goes to the course catalog)", get("hero", "cta2"))}
        ${field("h_cta1", "Button 2 text (jumps to the videos section)", get("hero", "cta1"))}
        ${field("h_cta3", "Button 3 text (goes to the store)", get("hero", "cta3"))}
      </div>
      <div class="form-field full">
        <label>Hero photo <span class="hint">optional — leave empty to keep the current photo</span></label>
        <input type="file" id="h_image" accept="image/*">
      </div>
    </form>

    <form class="panel" data-section="about">
      <div class="panel-head"><div><h2>About section</h2><p>The story section with your photo.</p></div><button type="submit" class="btn btn-primary btn-sm">Save</button></div>
      <div class="form-grid">
        ${field("a_eyebrow", "Eyebrow text", get("about", "eyebrow"))}
        ${field("a_title", "Title", get("about", "title"))}
      </div>
      <div class="form-field full">
        <label>Photo <span class="hint">optional — leave empty to keep the current photo</span></label>
        <input type="file" id="a_image" accept="image/*">
      </div>
      <label style="font-size:.8rem; font-weight:600; color:var(--text-muted); display:block; margin-bottom:8px;">Paragraphs</label>
      ${listWrap("aboutParaList", "+ Add paragraph")}
      <label style="font-size:.8rem; font-weight:600; color:var(--text-muted); display:block; margin:16px 0 8px;">Timeline</label>
      ${listWrap("aboutTimelineList", "+ Add timeline entry")}
    </form>

    <form class="panel" data-section="growth">
      <div class="panel-head"><div><h2>"From Zero to Building Impact" journey</h2></div><button type="submit" class="btn btn-primary btn-sm">Save</button></div>
      <div class="form-grid">
        ${field("g_eyebrow", "Eyebrow text", get("growth", "eyebrow"))}
        ${field("g_title", "Title", get("growth", "title"))}
      </div>
      <label style="font-size:.8rem; font-weight:600; color:var(--text-muted); display:block; margin-bottom:8px;">Journey steps</label>
      ${listWrap("growthList", "+ Add step")}
    </form>

    <form class="panel" data-section="testimonials">
      <div class="panel-head"><div><h2>Testimonials</h2></div><button type="submit" class="btn btn-primary btn-sm">Save</button></div>
      <div class="form-grid">
        ${field("t_eyebrow", "Eyebrow text", get("testimonials", "eyebrow"))}
        ${field("t_title", "Title", get("testimonials", "title"))}
        ${field("t_tab1", "Tab 1 label", get("testimonials", "tab1"))}
        ${field("t_tab2", "Tab 2 label", get("testimonials", "tab2"))}
      </div>
      <label style="font-size:.8rem; font-weight:600; color:var(--text-muted); display:block; margin-bottom:8px;">Tab 1 testimonials</label>
      ${listWrap("testiStudentsList", "+ Add testimonial")}
      <label style="font-size:.8rem; font-weight:600; color:var(--text-muted); display:block; margin:16px 0 8px;">Tab 2 testimonials</label>
      ${listWrap("testiAudienceList", "+ Add testimonial")}
    </form>

    <form class="panel" data-section="press">
      <div class="panel-head"><div><h2>Press & media appearances</h2></div><button type="submit" class="btn btn-primary btn-sm">Save</button></div>
      <div class="form-grid">
        ${field("p_eyebrow", "Eyebrow text", get("press", "eyebrow"))}
        ${field("p_title", "Title", get("press", "title"))}
      </div>
      <label style="font-size:.8rem; font-weight:600; color:var(--text-muted); display:block; margin-bottom:8px;">Appearances</label>
      ${listWrap("pressList", "+ Add appearance")}
    </form>

    <form class="panel" data-section="footer">
      <div class="panel-head"><div><h2>Footer</h2></div><button type="submit" class="btn btn-primary btn-sm">Save</button></div>
      ${field("f_tagline", "Tagline (shown on every page's footer)", get("footer", "tagline"), { textarea: true, full: true })}
    </form>`;

  /* ---------- populate list editors ---------- */
  (get("about", "paragraphs", [])).forEach((x) => addListItem("aboutParaList", SCHEMA.aboutParagraphs, x));
  (get("about", "timeline", [])).forEach((x) => addListItem("aboutTimelineList", SCHEMA.aboutTimeline, x));
  (get("growth", "items", [])).forEach((x) => addListItem("growthList", SCHEMA.growthItems, x));
  (get("testimonials", "students", [])).forEach((x) => addListItem("testiStudentsList", SCHEMA.testimonialItem, x));
  (get("testimonials", "audience", [])).forEach((x) => addListItem("testiAudienceList", SCHEMA.testimonialItem, x));
  (get("press", "items", [])).forEach((x) => addListItem("pressList", SCHEMA.pressItems, x));

  /* ---------- wire "+ Add" buttons ---------- */
  wireAddButtons(content, {
    aboutParaList: { schema: SCHEMA.aboutParagraphs },
    aboutTimelineList: { schema: SCHEMA.aboutTimeline },
    growthList: { schema: SCHEMA.growthItems },
    testiStudentsList: { schema: SCHEMA.testimonialItem },
    testiAudienceList: { schema: SCHEMA.testimonialItem },
    pressList: { schema: SCHEMA.pressItems },
  });

  /* ---------- wire section save handlers ---------- */
  content.querySelector('[data-section="visibility"]').addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.submitter;
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = "Saving…";
    try {
      const rows = Array.from(content.querySelectorAll("[data-visibility]"));
      // Only write the ones that actually changed, so this stays a cheap save.
      const changed = rows.filter((input) => input.checked !== (VISIBLE[input.dataset.visibility] !== false));
      for (const input of changed) {
        const key = input.dataset.visibility;
        // upsert (not update) so a section whose row doesn't exist yet — e.g. the
        // layout-only ones seeded by schema.sql — still gets written.
        const { error: err } = await c.from("home_content").upsert({ key, is_visible: input.checked });
        if (err) throw err;
        VISIBLE[key] = input.checked;
      }
      Admin.toast(changed.length ? "Saved — the site updates immediately." : "Nothing changed.");
    } catch (err) {
      Admin.toast("Couldn't save: " + (err.message || err), true);
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  });

  content.querySelector('[data-section="hero"]').addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.submitter;
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = "Saving…";
    try {
      let image_url = get("hero", "image_url", "");
      const fileInput = document.getElementById("h_image");
      if (fileInput.files[0]) {
        image_url = await Admin.uploadImage(fileInput.files[0], "home");
      }
      const value = {
        eyebrow: v("h_eyebrow"), title: v("h_title"), sub: v("h_sub"),
        cta1: v("h_cta1"), cta2: v("h_cta2"), cta3: v("h_cta3"), image_url,
      };
      const { error: err } = await c.from("home_content").upsert({ key: "hero", value });
      if (err) throw err;
      HOME.hero = value;
      Admin.toast("Saved — now live on the homepage.");
    } catch (err) {
      Admin.toast("Couldn't save: " + (err.message || err), true);
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  });

  content.querySelector('[data-section="about"]').addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.submitter;
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = "Saving…";
    try {
      let image_url = get("about", "image_url", "");
      const fileInput = document.getElementById("a_image");
      if (fileInput.files[0]) {
        image_url = await Admin.uploadImage(fileInput.files[0], "home");
      }
      const value = {
        eyebrow: v("a_eyebrow"), title: v("a_title"), image_url,
        paragraphs: collectList("aboutParaList", SCHEMA.aboutParagraphs),
        timeline: collectList("aboutTimelineList", SCHEMA.aboutTimeline),
      };
      const { error: err } = await c.from("home_content").upsert({ key: "about", value });
      if (err) throw err;
      Admin.toast("Saved — now live on the homepage.");
    } catch (err) {
      Admin.toast("Couldn't save: " + (err.message || err), true);
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  });

  content.querySelector('[data-section="growth"]').addEventListener("submit", (e) => {
    e.preventDefault();
    saveSection("growth", { eyebrow: v("g_eyebrow"), title: v("g_title"), items: collectList("growthList", SCHEMA.growthItems) }, e.submitter);
  });

  content.querySelector('[data-section="testimonials"]').addEventListener("submit", (e) => {
    e.preventDefault();
    saveSection("testimonials", {
      eyebrow: v("t_eyebrow"), title: v("t_title"), tab1: v("t_tab1"), tab2: v("t_tab2"),
      students: collectList("testiStudentsList", SCHEMA.testimonialItem),
      audience: collectList("testiAudienceList", SCHEMA.testimonialItem),
    }, e.submitter);
  });

  content.querySelector('[data-section="press"]').addEventListener("submit", (e) => {
    e.preventDefault();
    saveSection("press", { eyebrow: v("p_eyebrow"), title: v("p_title"), items: collectList("pressList", SCHEMA.pressItems) }, e.submitter);
  });

  content.querySelector('[data-section="footer"]').addEventListener("submit", (e) => {
    e.preventDefault();
    saveSection("footer", { tagline: v("f_tagline") }, e.submitter);
  });

  function v(id) {
    return document.getElementById(id).value.trim();
  }
})();
