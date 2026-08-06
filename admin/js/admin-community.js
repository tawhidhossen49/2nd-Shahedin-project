/* =========================================================
   admin-community.js
   ---------------------------------------------------------
   Manages the links shown on the student dashboard's
   "কমিউনিটি" tab: Discord, Telegram, a Facebook group, a
   WhatsApp group, or anything else.

   Stored in site_settings under the key "community" — the same
   jsonb key/value table the legal pages use, so this needs no
   migration.

   >>> THESE LINKS ARE PUBLICLY READABLE. <<<
   site_settings has an "anyone can read" policy, which is what
   lets the dashboard load them. Anyone who knows the API can
   read them too, logged in or not. Discord and Telegram invite
   links are meant to be shared, so that is normally fine — but
   do not put anything here that is supposed to be secret. A
   genuinely gated community link would need the same treatment
   products_safe gives paid downloads.
   ========================================================= */
(async function () {
  "use strict";
  const admin = await Admin.requireAdmin();
  if (!admin) return;

  Admin.renderShell(
    "community.html",
    "Community",
    "Links students see on the Community tab of their dashboard. Changes go live immediately.",
    admin
  );
  const content = document.getElementById("adminContent");
  content.innerHTML = `<div class="loading-row"><div class="spinner"></div> Loading…</div>`;

  const c = Admin.client();

  const PLATFORMS = [
    { id: "discord", label: "Discord" },
    { id: "telegram", label: "Telegram" },
    { id: "whatsapp", label: "WhatsApp" },
    { id: "facebook", label: "Facebook group" },
    { id: "youtube", label: "YouTube" },
    { id: "link", label: "Other link" },
  ];

  const { data, error } = await c.from("site_settings").select("value").eq("key", "community").maybeSingle();
  if (error) {
    content.innerHTML = `<div class="notice">Couldn't load: ${Admin.escapeHtml(error.message)}</div>`;
    return;
  }
  const saved = (data && data.value) || {};
  const savedLinks = Array.isArray(saved.links) ? saved.links : [];

  content.innerHTML = `
    <div class="notice" style="margin-bottom:20px;">
      These links are <strong>publicly readable</strong> through the site's API, which is how the
      dashboard loads them. Invite links for Discord, Telegram and WhatsApp groups are meant to be
      shared, so that is normally fine. Don't put anything secret here.
    </div>

    <form class="panel" id="communityForm">
      <div class="panel-head">
        <div><h2>Community tab</h2><p>The heading and intro line students see above the links.</p></div>
        <button type="submit" class="btn btn-primary btn-sm">Save</button>
      </div>
      <div class="form-grid">
        <div class="form-field full">
          <label for="f_title">Tab heading</label>
          <input type="text" id="f_title" value="${Admin.escapeHtml(saved.title || "")}" placeholder="কমিউনিটি">
        </div>
        <div class="form-field full">
          <label for="f_intro">Intro line</label>
          <input type="text" id="f_intro" value="${Admin.escapeHtml(saved.intro || "")}"
                 placeholder="অন্য শিক্ষার্থীদের সাথে যুক্ত হোন, প্রশ্ন করুন এবং আপডেট পান।">
        </div>
      </div>

      <label style="font-size:.8rem; font-weight:600; color:var(--text-2); display:block; margin:16px 0 10px;">Links</label>
      <div id="linkList" style="display:flex; flex-direction:column; gap:12px; margin-bottom:12px;"></div>
      <button type="button" class="btn btn-ghost btn-sm" id="addLinkBtn">+ Add a link</button>
    </form>`;

  const list = document.getElementById("linkList");

  function addRow(item) {
    const v = item || {};
    const row = document.createElement("div");
    row.className = "module-block";
    row.innerHTML = `
      <div class="module-head" style="align-items:flex-start; gap:12px;">
        <div style="flex:1; display:grid; grid-template-columns:170px 1fr; gap:10px;">
          <select class="f-platform">
            ${PLATFORMS.map((p) => `<option value="${p.id}" ${v.platform === p.id ? "selected" : ""}>${p.label}</option>`).join("")}
          </select>
          <input type="text" class="f-label" placeholder="What students see, e.g. ডিসকর্ড সার্ভার" value="${Admin.escapeHtml(v.label || "")}">
          <input type="url" class="f-url" placeholder="https://discord.gg/..." value="${Admin.escapeHtml(v.url || "")}" style="grid-column:1/-1;">
          <input type="text" class="f-desc" placeholder="One line about it (optional)" value="${Admin.escapeHtml(v.desc || "")}" style="grid-column:1/-1;">
        </div>
        <div style="display:flex; flex-direction:column; gap:4px;">
          <button type="button" class="icon-btn move-up" title="Move up">↑</button>
          <button type="button" class="icon-btn move-down" title="Move down">↓</button>
          <button type="button" class="icon-btn remove-row" title="Remove">✕</button>
        </div>
      </div>`;

    row.querySelector(".remove-row").addEventListener("click", () => row.remove());
    // Order here is the order students see, so it has to be changeable.
    row.querySelector(".move-up").addEventListener("click", () => {
      if (row.previousElementSibling) list.insertBefore(row, row.previousElementSibling);
    });
    row.querySelector(".move-down").addEventListener("click", () => {
      if (row.nextElementSibling) list.insertBefore(row.nextElementSibling, row);
    });

    list.appendChild(row);
  }

  savedLinks.forEach(addRow);
  if (!savedLinks.length) addRow(null);
  document.getElementById("addLinkBtn").addEventListener("click", () => addRow(null));

  document.getElementById("communityForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.submitter;
    Admin.clearFieldErrors(content);

    const rows = Array.from(list.children);
    const links = [];
    let bad = null;

    for (const row of rows) {
      const label = row.querySelector(".f-label").value.trim();
      const url = row.querySelector(".f-url").value.trim();
      // A completely blank row is just an unused slot, not an error.
      if (!label && !url) continue;

      if (!label) { bad = { el: row.querySelector(".f-label"), msg: "Give this link a name students will understand." }; break; }
      if (!/^https?:\/\/\S+$/i.test(url)) { bad = { el: row.querySelector(".f-url"), msg: "Enter the full link, starting with https://" }; break; }

      links.push({
        platform: row.querySelector(".f-platform").value,
        label,
        url,
        desc: row.querySelector(".f-desc").value.trim(),
      });
    }

    if (bad) {
      Admin.showFieldError(bad.el, bad.msg);
      bad.el.focus();
      Admin.toast(bad.msg, true);
      return;
    }

    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Saving…";

    // Merged into the existing row so this can never clobber another setting
    // that happens to share the key later.
    const value = Object.assign({}, saved, {
      title: document.getElementById("f_title").value.trim(),
      intro: document.getElementById("f_intro").value.trim(),
      links,
    });

    const { error: err } = await c.from("site_settings").upsert({ key: "community", value });
    btn.disabled = false;
    btn.textContent = original;

    if (err) { Admin.toast("Couldn't save: " + err.message, true); return; }
    Admin.toast(links.length ? `Saved. ${links.length} link${links.length > 1 ? "s" : ""} live on the dashboard.` : "Saved. No links are showing yet.");
  });
})();
