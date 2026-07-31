(async function () {
  "use strict";
  const admin = await Admin.requireAdmin();
  if (!admin) return;

  Admin.renderShell("settings.html", "Settings", "These change site-wide text without touching any code.", admin);
  const content = document.getElementById("adminContent");
  content.innerHTML = `<div class="loading-row"><div class="spinner"></div> Loading settings…</div>`;

  const c = Admin.client();
  const { data, error } = await c.from("site_settings").select("*");
  if (error) {
    content.innerHTML = `<div class="notice">Couldn't load settings: ${Admin.escapeHtml(error.message)}<br><br>
      If this is a fresh database, make sure you've run the latest <code>schema.sql</code> in the Supabase SQL editor — it adds the <code>site_settings</code> table.</div>`;
    return;
  }

  const settings = {};
  (data || []).forEach((row) => { settings[row.key] = row.value || {}; });
  const contact = settings.contact || {};
  const social = settings.social || {};
  const announcement = settings.announcement || {};

  content.innerHTML = `
    <form id="settingsForm">
      <div class="panel">
        <div class="panel-head"><div><h2>Contact info</h2><p>Shown on the Contact page and anywhere else the site references it.</p></div></div>
        <div class="form-grid">
          <div class="form-field"><label>Email</label><input type="email" id="s_email" value="${Admin.escapeHtml(contact.email || "")}"></div>
          <div class="form-field"><label>Phone</label><input type="tel" id="s_phone" value="${Admin.escapeHtml(contact.phone || "")}"></div>
          <div class="form-field">
            <label>WhatsApp chat link <span class="hint">powers the floating support button on every page</span></label>
            <input type="url" id="s_whatsapp" placeholder="https://wa.me/8801XXXXXXXXX" value="${Admin.escapeHtml(contact.whatsapp || "")}">
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head"><div><h2>Social links</h2></div></div>
        <div class="form-grid">
          <div class="form-field"><label>YouTube</label><input type="url" id="s_youtube" value="${Admin.escapeHtml(social.youtube || "")}"></div>
          <div class="form-field"><label>Facebook</label><input type="url" id="s_facebook" value="${Admin.escapeHtml(social.facebook || "")}"></div>
          <div class="form-field"><label>Instagram</label><input type="url" id="s_instagram" value="${Admin.escapeHtml(social.instagram || "")}"></div>
          <div class="form-field"><label>LinkedIn</label><input type="url" id="s_linkedin" value="${Admin.escapeHtml(social.linkedin || "")}"></div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head"><div><h2>Site announcement</h2><p>A banner you can turn on for sales, new courses, etc. (Requires a small one-time code addition to display — see README.)</p></div></div>
        <label class="form-check" style="margin-bottom:16px;"><input type="checkbox" id="s_announce_on" ${announcement.enabled ? "checked" : ""}> Show announcement banner</label>
        <div class="form-grid">
          <div class="form-field"><label>Text (English)</label><input type="text" id="s_announce_en" value="${Admin.escapeHtml(announcement.text_en || "")}"></div>
          <div class="form-field"><label>Text (Bangla)</label><input type="text" id="s_announce_bn" value="${Admin.escapeHtml(announcement.text_bn || "")}"></div>
        </div>
      </div>

      <button type="submit" class="btn btn-primary" id="saveSettingsBtn">Save settings</button>
    </form>`;

  document.getElementById("settingsForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("saveSettingsBtn");
    btn.disabled = true;
    btn.textContent = "Saving…";

    const updates = [
      { key: "contact", value: {
        email: document.getElementById("s_email").value.trim(),
        phone: document.getElementById("s_phone").value.trim(),
        whatsapp: document.getElementById("s_whatsapp").value.trim(),
      }},
      { key: "social", value: {
        youtube: document.getElementById("s_youtube").value.trim(),
        facebook: document.getElementById("s_facebook").value.trim(),
        instagram: document.getElementById("s_instagram").value.trim(),
        linkedin: document.getElementById("s_linkedin").value.trim(),
      }},
      { key: "announcement", value: {
        enabled: document.getElementById("s_announce_on").checked,
        text_en: document.getElementById("s_announce_en").value.trim(),
        text_bn: document.getElementById("s_announce_bn").value.trim(),
      }},
    ];

    const { error: upErr } = await c.from("site_settings").upsert(updates);
    btn.disabled = false;
    btn.textContent = "Save settings";
    if (upErr) { Admin.toast("Couldn't save: " + upErr.message, true); return; }
    Admin.toast("Settings saved.");
  });
})();
