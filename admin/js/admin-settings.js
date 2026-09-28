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
        <div class="panel-head"><div><h2>Contact info</h2><p>These fill in the contact details on the Contact page. Change one here and it updates on the site — no page is edited separately.</p></div></div>
        <div class="form-grid">
          <div class="form-field">
            <label>Email <span class="hint">shown and linked on the Contact page</span></label>
            <input type="email" id="s_email" placeholder="hello@shahedin.com" value="${Admin.escapeHtml(contact.email || "")}">
          </div>
          <div class="form-field">
            <label>Business phone — shown <span class="hint">exactly how visitors see it</span></label>
            <input type="text" id="s_phone_display" placeholder="+880 1000-000000" value="${Admin.escapeHtml(contact.phone_display || "")}">
          </div>
          <div class="form-field">
            <label>Business phone — link <span class="hint">where tapping it goes: a phone number, or a wa.me link</span></label>
            <input type="text" id="s_phone" placeholder="+8801000000000" value="${Admin.escapeHtml(contact.phone || "")}">
          </div>
          <div class="form-field">
            <label>WhatsApp chat link <span class="hint">also powers the floating support button on every page</span></label>
            <input type="url" id="s_whatsapp" placeholder="https://wa.me/8801XXXXXXXXX" value="${Admin.escapeHtml(contact.whatsapp || "")}">
          </div>
          <div class="form-field">
            <label>WhatsApp link text <span class="hint">the clickable words on the Contact page</span></label>
            <input type="text" id="s_whatsapp_label" placeholder="হোয়াটসঅ্যাপে মেসেজ করুন" value="${Admin.escapeHtml(contact.whatsapp_label || "")}">
          </div>
          <div class="form-field">
            <label>Response-time promise <span class="hint">the small line under the contact form</span></label>
            <input type="text" id="s_response_time" placeholder="আমরা সাধারণত ২৪ ঘণ্টার মধ্যে উত্তর দিই।" value="${Admin.escapeHtml(contact.response_time || "")}">
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head"><div><h2>Social links</h2><p>These drive the social icons in the footer of <strong>every</strong> page, plus the channel buttons on the homepage. Leave a field empty to hide that icon site-wide.</p></div></div>
        <div class="form-grid">
          <div class="form-field"><label>YouTube</label><input type="url" id="s_youtube" placeholder="https://youtube.com/@shahedin" value="${Admin.escapeHtml(social.youtube || "")}"></div>
          <div class="form-field"><label>YouTube button text <span class="hint">homepage channel button</span></label><input type="text" id="s_youtube_label" placeholder="ইউটিউব চ্যানেল" value="${Admin.escapeHtml(social.youtube_label || "")}"></div>
          <div class="form-field"><label>Facebook page</label><input type="url" id="s_facebook" placeholder="https://facebook.com/shahedin" value="${Admin.escapeHtml(social.facebook || "")}"></div>
          <div class="form-field"><label>Facebook page button text</label><input type="text" id="s_facebook_label" placeholder="ফেইসবুক পেইজ" value="${Admin.escapeHtml(social.facebook_label || "")}"></div>
          <div class="form-field"><label>Facebook profile <span class="hint">the personal profile, separate from the page</span></label><input type="url" id="s_facebook_profile" value="${Admin.escapeHtml(social.facebook_profile || "")}"></div>
          <div class="form-field"><label>Facebook profile button text</label><input type="text" id="s_facebook_profile_label" placeholder="ফেইসবুক প্রোফাইল" value="${Admin.escapeHtml(social.facebook_profile_label || "")}"></div>
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

  // Small helper so a missing field can never throw and lose the whole save.
  function val(id) {
    const el = document.getElementById(id);
    return el ? el.value.trim() : "";
  }

  document.getElementById("settingsForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("saveSettingsBtn");
    btn.disabled = true;
    btn.textContent = "Saving…";

    const updates = [
      { key: "contact", value: {
        email: val("s_email"),
        phone: val("s_phone"),
        phone_display: val("s_phone_display"),
        whatsapp: val("s_whatsapp"),
        whatsapp_label: val("s_whatsapp_label"),
        response_time: val("s_response_time"),
      }},
      { key: "social", value: {
        youtube: val("s_youtube"),
        youtube_label: val("s_youtube_label"),
        facebook: val("s_facebook"),
        facebook_label: val("s_facebook_label"),
        facebook_profile: val("s_facebook_profile"),
        facebook_profile_label: val("s_facebook_profile_label"),
        instagram: val("s_instagram"),
        linkedin: val("s_linkedin"),
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
