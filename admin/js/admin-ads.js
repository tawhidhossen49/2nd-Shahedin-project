/* =========================================================
   admin-ads.js — Facebook ads (Meta Pixel)
   ---------------------------------------------------------
   Written for someone who does not use admin panels: Bangla
   first, one big on/off switch, three automatic checks that
   say in plain words whether everything is working, and a
   guided test. The Pixel ID is tucked away under "advanced"
   because it is set once and then never touched.

   Where things live (see schema.sql section 37 and
   supabase/functions/_shared/meta.ts):
     site_settings "meta_pixel"   { enabled, pixel_id }
     META_CAPI_TOKEN              server secret, never shown
     meta-ads Edge Function       status check + test events
   ========================================================= */
(async function () {
  "use strict";
  const admin = await Admin.requireAdmin();
  if (!admin) return;

  Admin.renderShell("ads.html", "Facebook ads", "Facebook বিজ্ঞাপনের জন্য Meta Pixel — চালু/বন্ধ করুন এবং দেখুন সব ঠিকমতো কাজ করছে কিনা।", admin);
  const content = document.getElementById("adminContent");
  const c = Admin.client();
  const esc = Admin.escapeHtml;

  let setting = { enabled: false, pixel_id: "", ad_account_id: "" };
  let period = "last_7d";
  const resultsCache = {}; // period -> reply, so switching tabs back is instant
  let server = null; // reply from meta-ads "status", or { unavailable: true }

  content.innerHTML = `<div class="loading-row"><div class="spinner"></div> লোড হচ্ছে… / Loading…</div>`;

  async function loadSetting() {
    const { data, error } = await c.from("site_settings").select("value").eq("key", "meta_pixel").maybeSingle();
    if (error) throw error;
    const v = (data && data.value) || {};
    setting = {
      enabled: v.enabled === true,
      pixel_id: String(v.pixel_id || "").trim(),
      ad_account_id: String(v.ad_account_id || "").replace(/^act_/, "").trim(),
    };
  }

  async function loadServer() {
    try {
      const { data, error } = await c.functions.invoke("meta-ads", { body: { action: "status" } });
      server = error ? { unavailable: true } : data;
    } catch (err) {
      server = { unavailable: true };
    }
  }

  try {
    await Promise.all([loadSetting(), loadServer()]);
  } catch (err) {
    content.innerHTML = `<div class="notice">সেটিংস লোড করা যায়নি। পেজটি আবার লোড করুন।<br><span class="hint">Couldn't load the settings: ${esc(err.message || String(err))}</span></div>`;
    return;
  }

  const validId = (id) => /^\d{6,20}$/.test(id);
  const eventsManagerUrl = (id) => `https://business.facebook.com/events_manager2/list/pixel/${encodeURIComponent(id)}/test_events`;

  function render() {
    const on = setting.enabled && validId(setting.pixel_id);
    const tokenOk = server && !server.unavailable && server.token && server.token.valid;

    const checks = [
      pageCheckResult(),
      validId(setting.pixel_id)
        ? { ok: true, text: `Pixel ID বসানো আছে: <b>${esc(setting.pixel_id)}</b>`, sub: "Pixel ID is saved." }
        : { ok: false, text: "Pixel ID বসানো নেই", sub: "নিচে “উন্নত সেটিংস”-এ Pixel ID বসান। / No Pixel ID yet — add it under Advanced settings below." },
      server && server.unavailable
        ? { ok: false, text: "Facebook সার্ভার সংযোগ এখনো চালু করা হয়নি", sub: "ডেভেলপারকে “meta-ads” ফাংশনটি চালু করতে বলুন। / The meta-ads function is not deployed yet." }
        : tokenOk
          ? { ok: true, text: "Facebook-এর সাথে সার্ভার সংযোগ ঠিক আছে", sub: "বিক্রির তথ্য সরাসরি সার্ভার থেকেও Facebook-এ যায়। / Server connection to Facebook works." }
          : { ok: false, text: "Facebook সার্ভার সংযোগে সমস্যা", sub: "ডেভেলপারকে জানান — Access token নতুন করে দিতে হতে পারে। / " + esc((server && server.token && server.token.message) || "The access token is missing or no longer valid.") },
      on
        ? { ok: true, text: "বিক্রি ও অন্যান্য তথ্য Facebook-এ যাচ্ছে", sub: "কোর্স দেখা, চেকআউট, কেনা, নতুন অ্যাকাউন্ট। / Course views, checkouts, purchases and sign-ups are being sent." }
        : { ok: false, warn: true, text: "বিক্রির তথ্য পাঠানো বন্ধ আছে", sub: "Facebook এখন শুধু পেজ ভিজিট পাচ্ছে। উপরের সুইচ চালু করুন। / Only page visits are sent — use the switch above." },
      adAccountCheck(),
    ];

    content.innerHTML = `
      <section class="ads-hero ${on ? "is-on" : "is-off"}">
        <div class="ads-hero-main">
          <span class="ads-light" aria-hidden="true"></span>
          <div class="ads-hero-text">
            <h2>${on ? "Facebook Pixel চালু আছে" : "বিক্রির তথ্য পাঠানো বন্ধ আছে"}</h2>
            <p>${on
              ? "ওয়েবসাইটের সব পেজে Pixel বসানো আছে। কে আসছে, কে কোর্স দেখছে, কে চেকআউটে যাচ্ছে আর কে কিনছে — সব তথ্য Facebook পাচ্ছে। এতে আপনার বিজ্ঞাপন ঠিক মানুষের কাছে যায় এবং কোন বিজ্ঞাপন থেকে কত বিক্রি হলো তা দেখা যায়।"
              : "Pixel সব পেজে বসানো আছে, তাই Facebook পেজ ভিজিট পাচ্ছে। কিন্তু কে কোর্স দেখছে বা কে কিনছে তা পাচ্ছে না — তাই বিজ্ঞাপন বিক্রি গুনতে পারবে না। বিজ্ঞাপন চালানোর সময় সুইচটি চালু রাখুন।"}</p>
            <p class="hint">${on ? "The Pixel is on every page and Facebook receives visits, checkouts and sales." : "Facebook receives page visits only, not course views or sales."}</p>
          </div>
          <label class="ads-switch" title="${on ? "বন্ধ করুন / Turn off" : "চালু করুন / Turn on"}">
            <input type="checkbox" id="adsToggle" ${on ? "checked" : ""} aria-label="Facebook tracking on or off">
            <span class="ads-switch-track"><span class="ads-switch-label">${on ? "চালু" : "বন্ধ"}</span></span>
          </label>
        </div>
        <ul class="ads-checks">
          ${checks.map((k) => `
            <li class="${k.ok ? "ok" : k.warn ? "warn" : "bad"}">
              <span class="ads-check-mark" aria-hidden="true">${k.ok ? "✓" : k.warn ? "!" : "✕"}</span>
              <span><b>${k.text}</b><span class="hint">${k.sub}</span></span>
            </li>`).join("")}
        </ul>
      </section>

      <section class="panel ads-results">
        <div class="panel-head">
          <div>
            <h2>বিজ্ঞাপনের ফলাফল</h2>
            <p>Your Facebook ad results. Facebook-এর হিসাব কয়েক ঘণ্টা দেরিতে আপডেট হয়।</p>
          </div>
          ${setting.ad_account_id ? `<a class="btn btn-ghost btn-sm" href="https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${encodeURIComponent(setting.ad_account_id)}" target="_blank" rel="noopener">Ads Manager-এ বিস্তারিত ↗</a>` : ""}
        </div>
        <div class="period-tabs" role="group" aria-label="সময়">
          ${PERIOD_LABELS.map(([key, bn, en]) => `<button type="button" class="period-tab${key === period ? " active" : ""}" data-period="${key}" aria-pressed="${key === period}">${bn}<span>${en}</span></button>`).join("")}
        </div>
        <div id="resultsBody" aria-live="polite"></div>
      </section>

      <div class="panel">
        <div class="panel-head"><div>
          <h2>Facebook-কে কী কী জানানো হয়</h2>
          <p>What your website tells Facebook. কোনো কিছু বদলানোর দরকার নেই — এগুলো নিজে থেকেই হয়।</p>
        </div></div>
        <table class="admin-table ads-events">
          <thead><tr><th>যখন / When</th><th>Facebook-এ নাম</th></tr></thead>
          <tbody>
            <tr><td><div>কেউ ওয়েবসাইটের যেকোনো পেজ দেখলে <b>(সবসময়)</b><span class="row-sub">Someone opens any page — always sent, it is part of every page</span></div></td><td><code>PageView</code></td></tr>
            <tr><td><div>কেউ কোনো কোর্স বা প্রোডাক্টের পেজ দেখলে<span class="row-sub">Someone opens a course or product</span></div></td><td><code>ViewContent</code></td></tr>
            <tr><td><div>কেউ “এখনই কিনুন” চেপে চেকআউটে গেলে<span class="row-sub">Someone starts checkout</span></div></td><td><code>InitiateCheckout</code></td></tr>
            <tr><td><div>bKash-এ টাকা পরিশোধ সফল হলে (টাকার পরিমাণসহ)<span class="row-sub">A bKash payment succeeds, with the amount</span></div></td><td><code>Purchase</code></td></tr>
            <tr><td><div>কেউ নতুন অ্যাকাউন্ট খুললে<span class="row-sub">Someone creates an account</span></div></td><td><code>CompleteRegistration</code></td></tr>
            <tr><td><div>কেউ যোগাযোগ ফর্ম পাঠালে<span class="row-sub">Someone sends the contact form</span></div></td><td><code>Lead</code></td></tr>
          </tbody>
        </table>
        <p class="hint" style="margin-top:12px;">ক্রেতার ফোন ও ইমেইল Facebook-এ যায় শুধু গোপন কোড (SHA-256) আকারে — আসল নম্বর বা ইমেইল নয়। bKash টেস্ট পেমেন্ট ও ফ্রি কোর্স বিক্রি হিসেবে গোনা হয় না। / Phone and email are sent only as SHA-256 codes, never in plain text. Test payments and free courses are not counted as sales.</p>
      </div>

      <div class="panel">
        <div class="panel-head"><div>
          <h2>কাজ করছে কিনা পরীক্ষা করুন</h2>
          <p>Check it works — takes one minute. আসল বিক্রির হিসাবে এটি যোগ হয় না। / Test events are not counted as real visits or sales.</p>
        </div></div>
        <ol class="ads-steps">
          <li>
            Facebook <b>Events Manager</b>-এ আপনার Pixel-এর <b>Test events</b> পেজটি খুলুন।
            ${validId(setting.pixel_id) ? `<a class="btn btn-ghost btn-sm" href="${eventsManagerUrl(setting.pixel_id)}" target="_blank" rel="noopener">Events Manager খুলুন ↗</a>` : ""}
            <span class="hint">Open Events Manager → your Pixel → Test events.</span>
          </li>
          <li>
            সেখানে <b>TEST</b> দিয়ে শুরু হওয়া একটি কোড দেখবেন (যেমন TEST12345)। কোডটি কপি করে নিচের ঘরে বসান।
            <span class="hint">Copy the code that starts with TEST and paste it below.</span>
            <div class="ads-test-row">
              <input type="text" id="testCode" placeholder="TEST12345" autocomplete="off" spellcheck="false">
              <button type="button" class="btn btn-primary" id="sendTestBtn">টেস্ট পাঠান / Send test</button>
            </div>
            <div id="testResult" class="ads-test-result" hidden></div>
          </li>
          <li>
            কয়েক সেকেন্ডের মধ্যে Facebook-এর সেই পেজে <code>PageView</code> আর <code>Purchase</code> দেখা গেলে সব ঠিক আছে।
            <span class="hint">If PageView and Purchase appear there within a few seconds, everything works.</span>
          </li>
        </ol>
      </div>

      <details class="panel ads-advanced">
        <summary><b>উন্নত সেটিংস</b> <span class="hint">Advanced — সাধারণত কিছু বদলানোর দরকার হয় না</span></summary>
        <div class="form-field" style="margin-top:16px; max-width:420px;">
          <label>Pixel ID</label>
          <div class="ads-readonly">${esc(setting.pixel_id || "—")}</div>
          <span class="hint">এই নম্বরটি ওয়েবসাইটের প্রতিটি পেজের কোডে বসানো, তাই এখান থেকে বদলানো যায় না। নতুন Pixel ব্যবহার করতে হলে ডেভেলপারকে জানান। / This ID is written into every page's code, so it cannot be changed here.</span>
        </div>
        <div class="form-field" style="margin-top:22px; max-width:420px;">
          <label for="adAccountId">Ad account নম্বর <span class="hint">যে অ্যাকাউন্ট থেকে বিজ্ঞাপন চালান — Ads Manager-এর উপরে বাম দিকে / the account your ads run from, top-left in Ads Manager</span></label>
          <input type="text" id="adAccountId" inputmode="numeric" autocomplete="off" value="${esc(setting.ad_account_id)}" placeholder="1234567890123456">
        </div>
        <button type="button" class="btn btn-ghost" id="saveAccountBtn">Ad account সেভ করুন / Save</button>
        <p class="hint" style="margin-top:16px;">সার্ভারের গোপন চাবি (Access token) ডেভেলপার সার্ভারে সেট করে রেখেছেন। নিরাপত্তার জন্য এটি এখানে কখনো দেখানো হয় না, এবং এটি কখনো মেয়াদোত্তীর্ণ হয় না। বদলাতে হলে ডেভেলপারকে জানান।
          <br>The access token is kept as a server secret. For safety it is never shown here; ask your developer to replace it if Facebook ever says it is invalid.</p>
      </details>`;

    document.getElementById("adsToggle").addEventListener("change", onToggle);
    document.getElementById("sendTestBtn").addEventListener("click", sendTest);
    document.getElementById("saveAccountBtn").addEventListener("click", saveAdAccount);
    content.querySelectorAll(".period-tab").forEach((b) => b.addEventListener("click", () => {
      period = b.dataset.period;
      content.querySelectorAll(".period-tab").forEach((x) => {
        x.classList.toggle("active", x === b);
        x.setAttribute("aria-pressed", String(x === b));
      });
      loadResults();
    }));
    loadResults();
  }

  /* ---------- Ad results ---------- */

  const PERIOD_LABELS = [
    ["today", "আজ", "Today"],
    ["last_7d", "গত ৭ দিন", "Last 7 days"],
    ["last_30d", "গত ৩০ দিন", "Last 30 days"],
    ["this_month", "এই মাস", "This month"],
    ["maximum", "সব সময়", "All time"],
  ];

  // Bangla digits and grouping, the way Shahedin reads numbers.
  const bnNum = (n, digits = 0) => Number(n || 0).toLocaleString("bn-BD", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
  const money = (n, currency) => (currency && currency !== "BDT" ? `${currency} ` : "৳") + bnNum(n, n && n < 100 ? 2 : 0);

  function adAccountCheck() {
    const a = server && !server.unavailable ? server.adAccount : null;
    if (!a || a.reason === "no_token") {
      return { ok: false, warn: true, text: "বিজ্ঞাপনের ফলাফল দেখার সংযোগ এখনো নেই", sub: "ডেভেলপারকে জানান। / The read-only ads key is not on the server yet." };
    }
    if (a.connected) {
      return { ok: true, text: `বিজ্ঞাপন অ্যাকাউন্ট সংযুক্ত: <b>${esc(a.name || "")}</b>`, sub: `Ad account ${esc(a.id)}${a.active === false ? " — Facebook-এ অ্যাকাউন্টটি এখন সক্রিয় নয় / not active on Facebook" : ""}` };
    }
    if (a.reason === "no_account") {
      return { ok: false, warn: true, text: "বিজ্ঞাপন অ্যাকাউন্টের নম্বর বসানো নেই", sub: "নিচে “উন্নত সেটিংস”-এ বসান। / Add the ad account number under Advanced settings." };
    }
    return { ok: false, text: "বিজ্ঞাপন অ্যাকাউন্ট পড়া যাচ্ছে না", sub: "নম্বরটি ঠিক আছে কিনা দেখুন, বা ডেভেলপারকে জানান। / " + esc(a.message || "Facebook refused.") };
  }

  async function loadResults() {
    const box = document.getElementById("resultsBody");
    if (!box) return;
    if (resultsCache[period]) { renderResults(resultsCache[period]); return; }
    box.innerHTML = `<div class="loading-row"><div class="spinner"></div> Facebook থেকে আনা হচ্ছে… / Loading from Facebook…</div>`;
    const asked = period;
    let reply;
    try {
      const { data, error } = await c.functions.invoke("meta-ads", { body: { action: "results", period: asked } });
      if (error) {
        let message = "";
        try { message = (await error.context.json()).error; } catch (e) { message = ""; }
        reply = { connected: false, reason: "error", message: message || "সার্ভারে পৌঁছানো যায়নি। / Could not reach the server." };
      } else {
        reply = data;
        if (data && data.connected && !data.error) resultsCache[asked] = data;
      }
    } catch (err) {
      reply = { connected: false, reason: "error", message: err.message || String(err) };
    }
    if (asked === period) renderResults(reply);
  }

  function renderResults(r) {
    const box = document.getElementById("resultsBody");
    if (!box) return;
    if (!r || !r.connected) {
      const why = !r ? "" : r.reason === "no_token"
        ? "বিজ্ঞাপনের ফলাফল দেখার কী (token) সার্ভারে নেই। ডেভেলপারকে জানান।<span class=\"hint\">The read-only ads key is not on the server.</span>"
        : r.reason === "no_account"
          ? "Ad account নম্বর বসানো নেই। নিচে “উন্নত সেটিংস”-এ বসান।<span class=\"hint\">Add your ad account number under Advanced settings.</span>"
          : `Facebook থেকে ফলাফল আনা যায়নি।<span class="hint">${esc(r.message || "")}</span>`;
      box.innerHTML = `<div class="ads-empty">${why}</div>`;
      return;
    }
    const cur = r.account && r.account.currency;
    const site = r.site || { orders: 0, revenue: 0 };
    const siteLine = `<p class="ads-site-line">একই সময়ে ওয়েবসাইটে মোট বিক্রি: <b>${bnNum(site.orders)} টি</b> · <b>৳${bnNum(site.revenue)}</b> <span class="hint">— বিজ্ঞাপন ও অন্য সব জায়গা মিলিয়ে। / All website sales in the same period, from ads or not.</span></p>`;
    const accountLine = `<p class="hint ads-account-line">Ad account: ${esc((r.account && r.account.name) || "")} (${esc((r.account && r.account.id) || "")})</p>`;

    if (r.error) {
      box.innerHTML = `<div class="ads-empty">Facebook থেকে ফলাফল আনা যায়নি।<span class="hint">${esc(r.error)}</span></div>${accountLine}`;
      return;
    }
    if (!r.hasData) {
      box.innerHTML = `
        <div class="ads-empty">এই সময়ে এই অ্যাকাউন্ট থেকে কোনো বিজ্ঞাপন চলেনি।
          <span class="hint">No ads ran from this account in this period. অন্য অ্যাকাউন্ট থেকে বিজ্ঞাপন চালালে “উন্নত সেটিংস”-এ সেই নম্বর দিন।</span></div>
        ${siteLine}${accountLine}`;
      return;
    }

    const t = r.total;
    const cards = [
      { label: "খরচ হয়েছে", en: "Spent", value: money(t.spend, cur), note: "বিজ্ঞাপনে মোট খরচ" },
      { label: "বিজ্ঞাপন থেকে বিক্রি", en: "Sales from ads", value: `${bnNum(t.purchases)} টি`, note: t.purchaseValue ? `মোট ${money(t.purchaseValue, cur)}` : "Facebook যত বিক্রি বিজ্ঞাপনের ফল বলে গুনেছে", strong: true },
      { label: "প্রতি বিক্রিতে খরচ", en: "Cost per sale", value: t.costPerPurchase == null ? "—" : money(t.costPerPurchase, cur), note: t.costPerPurchase == null ? "এখনো কোনো বিক্রি নেই" : "যত কম, তত ভালো" },
      { label: "খরচের বিপরীতে ফেরত", en: "Return on ad spend", value: t.roas == null ? "—" : `${bnNum(t.roas, 2)} গুণ`, note: t.roas == null ? "বিক্রি হলে দেখা যাবে" : `প্রতি ৳১ খরচে ৳${bnNum(t.roas, 2)} বিক্রি`, good: t.roas != null && t.roas >= 1 },
      { label: "কতজন দেখেছে", en: "People reached", value: bnNum(t.reach), note: `মোট ${bnNum(t.impressions)} বার দেখানো হয়েছে` },
      { label: "লিংকে ক্লিক", en: "Link clicks", value: bnNum(t.linkClicks || t.clicks), note: `চেকআউট শুরু: ${bnNum(t.checkouts)} · নতুন অ্যাকাউন্ট: ${bnNum(t.registrations)}` },
    ];

    const rows = (r.campaigns || []).map((cpn) => `
      <tr>
        <td><div class="row-title">${esc(cpn.name || "")}</div></td>
        <td>${money(cpn.spend, cur)}</td>
        <td>${bnNum(cpn.linkClicks || cpn.clicks)}</td>
        <td>${bnNum(cpn.purchases)}</td>
        <td>${cpn.costPerPurchase == null ? "—" : money(cpn.costPerPurchase, cur)}</td>
      </tr>`).join("");

    box.innerHTML = `
      <div class="ads-cards">
        ${cards.map((k) => `
          <div class="ads-card${k.strong ? " is-strong" : ""}${k.good ? " is-good" : ""}">
            <span class="ads-card-label">${k.label}<span>${k.en}</span></span>
            <span class="ads-card-value">${k.value}</span>
            <span class="ads-card-note">${k.note}</span>
          </div>`).join("")}
      </div>
      ${siteLine}
      ${rows ? `
        <h3 class="ads-sub">ক্যাম্পেইন অনুযায়ী <span class="hint">By campaign</span></h3>
        <table class="admin-table">
          <thead><tr><th>ক্যাম্পেইন</th><th>খরচ</th><th>ক্লিক</th><th>বিক্রি</th><th>প্রতি বিক্রিতে খরচ</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>` : ""}
      ${accountLine}`;
  }

  async function saveAdAccount() {
    const input = document.getElementById("adAccountId");
    const id = input.value.replace(/\s+/g, "").replace(/^act_/i, "");
    if (!/^\d{5,25}$/.test(id)) {
      Admin.showFieldError(input, "শুধু সংখ্যা দিন, যেমন 1580041370084779। / Digits only.");
      return;
    }
    const btn = document.getElementById("saveAccountBtn");
    btn.disabled = true;
    try {
      await save({ ad_account_id: id });
      Object.keys(resultsCache).forEach((k) => delete resultsCache[k]);
      await loadServer();
      Admin.toast("Ad account সেভ হয়েছে। / Ad account saved.");
      render();
    } catch (err) {
      btn.disabled = false;
      Admin.toast("সেভ করা যায়নি: " + (err.message || err), true);
    }
  }

  /* Saves the whole row, changing only the fields passed in, so turning the
     switch never wipes the ad account number and vice versa. */
  async function save(next) {
    const merged = Object.assign({}, setting, next);
    const value = {
      enabled: !!merged.enabled,
      pixel_id: String(merged.pixel_id || "").trim(),
      ad_account_id: String(merged.ad_account_id || "").trim(),
    };
    const { error } = await c.from("site_settings").upsert({ key: "meta_pixel", value });
    if (error) throw error;
    setting = value;
  }

  /* Opens the site's own pages, exactly as a visitor's browser receives them,
     and looks for the Pixel code -- the check Shahedin did with Ctrl+U. It
     runs against whichever site this admin panel is on, so on shahedin.com
     it tests shahedin.com. */
  const CHECK_PAGES = [
    ["index.html", "হোমপেজ"],
    ["course-detail.html", "কোর্সের পেজ"],
    ["checkout.html", "চেকআউট"],
    ["payment-status.html", "পেমেন্টের পরের পেজ"],
  ];
  let pageCheck = null; // null = checking; else { found: [...], missing: [...], wrongId: bool }

  async function runPageCheck() {
    const results = await Promise.all(CHECK_PAGES.map(async ([file, label]) => {
      try {
        const res = await fetch("../" + file + "?pixelcheck=" + Date.now(), { cache: "no-store" });
        const html = res.ok ? await res.text() : "";
        const m = html.match(/fbq\(\s*['"]init['"]\s*,\s*['"](\d+)['"]/);
        return { label, id: m ? m[1] : null };
      } catch (err) {
        return { label, id: null };
      }
    }));
    pageCheck = {
      found: results.filter((r) => r.id).map((r) => r.label),
      missing: results.filter((r) => !r.id).map((r) => r.label),
      wrongId: results.some((r) => r.id && setting.pixel_id && r.id !== setting.pixel_id),
    };
    render();
  }

  function pageCheckResult() {
    if (!pageCheck) return { ok: false, warn: true, text: "ওয়েবসাইটের পেজে Pixel কোড খোঁজা হচ্ছে…", sub: "Checking the website's pages…" };
    if (pageCheck.missing.length) {
      return { ok: false, text: "কিছু পেজে Pixel কোড পাওয়া যায়নি: " + esc(pageCheck.missing.join(", ")), sub: "ওয়েবসাইটের নতুন কোড আপলোড হয়নি বলে মনে হচ্ছে — ডেভেলপারকে জানান। / The latest website code does not seem to be uploaded on these pages." };
    }
    if (pageCheck.wrongId) {
      return { ok: false, text: "পেজের Pixel ID আর সেটিংসের Pixel ID আলাদা", sub: "ডেভেলপারকে জানান। / The ID in the pages differs from the saved one." };
    }
    return { ok: true, text: "সব পেজে Pixel কোড বসানো আছে", sub: esc(pageCheck.found.join(" · ")) + " — Ctrl+U চেপে দেখলেও পাবেন। / Found on every page checked." };
  }

  async function onToggle(e) {
    const turnOn = e.target.checked;
    if (turnOn && !validId(setting.pixel_id)) {
      e.target.checked = false;
      Admin.toast("সেটিংসে Pixel ID নেই — ডেভেলপারকে জানান। / No Pixel ID in the settings; ask your developer.", true);
      return;
    }
    if (!turnOn && !confirm("বিক্রির তথ্য Facebook-এ পাঠানো বন্ধ করবেন?\n\nপেজ ভিজিট তবুও যাবে, কিন্তু Facebook আর বিক্রি গুনতে পারবে না।\n\nStop sending sales to Facebook? Page visits still go; sales will not be counted.")) {
      e.target.checked = true;
      return;
    }
    e.target.disabled = true;
    try {
      await save({ enabled: turnOn, pixel_id: setting.pixel_id });
      Admin.toast(turnOn ? "চালু হয়েছে — বিক্রির তথ্য এখন Facebook-এ যাচ্ছে। / Sales reporting is ON." : "বন্ধ হয়েছে — শুধু পেজ ভিজিট যাবে। / Sales reporting is OFF.");
      render();
    } catch (err) {
      e.target.checked = !turnOn;
      e.target.disabled = false;
      Admin.toast("সেভ করা যায়নি: " + (err.message || err), true);
    }
  }

  async function sendTest() {
    const input = document.getElementById("testCode");
    const box = document.getElementById("testResult");
    const btn = document.getElementById("sendTestBtn");
    const code = input.value.trim();
    box.hidden = false;
    if (!/^TEST\w{2,}$/i.test(code)) {
      box.className = "ads-test-result bad";
      box.innerHTML = "কোডটি TEST দিয়ে শুরু হওয়ার কথা। Events Manager-এর Test events পেজ থেকে কপি করুন। / The code should start with TEST.";
      return;
    }
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = "পাঠানো হচ্ছে… / Sending…";
    box.className = "ads-test-result";
    box.textContent = "পাঠানো হচ্ছে… / Sending…";
    try {
      const { data, error } = await c.functions.invoke("meta-ads", { body: { action: "test", test_event_code: code } });
      if (error) {
        let message = "";
        try { message = (await error.context.json()).error; } catch (e) { message = ""; }
        throw new Error(message || "সার্ভারে পৌঁছানো যায়নি। / Could not reach the server.");
      }
      const parts = [];
      parts.push(data.pageView && data.pageView.ok ? "✓ PageView পাঠানো হয়েছে" : `✕ PageView যায়নি${data.pageView && data.pageView.error ? ` — ${esc(data.pageView.error)}` : ""}`);
      if (data.purchase) parts.push(data.purchase.ok ? "✓ Purchase পাঠানো হয়েছে" : `✕ Purchase যায়নি${data.purchase.error ? ` — ${esc(data.purchase.error)}` : ""}`);
      const allOk = data.pageView && data.pageView.ok && (!data.purchase || data.purchase.ok);
      box.className = "ads-test-result " + (allOk ? "ok" : "bad");
      box.innerHTML = parts.join("<br>") + (allOk ? "<br><span class=\"hint\">এখন Facebook-এর Test events পেজে দেখুন। / Now look at the Test events page in Facebook.</span>" : "");
    } catch (err) {
      box.className = "ads-test-result bad";
      box.textContent = err.message || String(err);
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  }

  render();
  runPageCheck();
})();
