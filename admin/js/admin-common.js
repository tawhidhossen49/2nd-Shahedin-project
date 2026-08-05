/* =========================================================
   admin-common.js
   ---------------------------------------------------------
   Shared plumbing for every /admin page: Supabase client,
   login/admin-access guard, the sidebar layout, toasts, and
   a few small helpers. Loaded before every page-specific
   admin-*.js file.
   ========================================================= */
window.Admin = (function () {
  "use strict";

  const NAV = [
    { href: "index.html", label: "Dashboard", icon: "M4 4h7v9H4zM13 4h7v5h-7zM13 12h7v9h-7zM4 16h7v5H4z" },
    { href: "home.html", label: "Homepage Content", icon: "M3 11l9-8 9 8M5 10v10h14V10" },
    { href: "portfolio.html", label: "Portfolio & Stats", icon: "M4 19V5M4 19h16M9 19V9M14 19v-6M19 19V6" },
    { href: "courses.html", label: "Courses", icon: "M4 19.5A2.5 2.5 0 0 1 6.5 17H20 M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" },
    { href: "reviews.html", label: "Reviews", icon: "M12 2l2.9 6.3 6.9.9-5 4.9 1.2 6.9-6-3.2-6 3.2 1.2-6.9-5-4.9 6.9-.9z" },
    { href: "submissions.html", label: "Contact Messages", icon: "M4 4h16v16H4zM4 6l8 6 8-6" },
    { href: "students.html", label: "Students", icon: "M12 2 1 7l11 5 9-4.1V17h2V7zM5 13.2V17c0 2 3.1 4 7 4s7-2 7-4v-3.8l-7 3.2z" },
    { href: "products.html", label: "Store Products", icon: "M6 2 3 7v13a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V7l-3-5H6zM3 7h18M16 11a4 4 0 0 1-8 0" },
    { href: "orders.html", label: "Orders", icon: "M9 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM19 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6" },
    { href: "coupons.html", label: "Coupons", icon: "M20 12a2 2 0 0 1 2-2V7a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v3a2 2 0 0 1 0 4v3a1 1 0 0 0 1 1h18a1 1 0 0 0 1-1v-3a2 2 0 0 1-2-2zM13 7v2M13 15v2" },
    { href: "analytics.html", label: "Analytics", icon: "M4 19V5M4 19h16M9 19V9M14 19v-6M19 19V6" },
    { href: "settings.html", label: "Settings", icon: "M10.3 2.3h3.4l.6 2.4a7.9 7.9 0 0 1 2 1.2l2.4-.8 1.7 3-1.9 1.6a8 8 0 0 1 0 2.3l1.9 1.6-1.7 3-2.4-.8a7.9 7.9 0 0 1-2 1.2l-.6 2.4h-3.4l-.6-2.4a7.9 7.9 0 0 1-2-1.2l-2.4.8-1.7-3 1.9-1.6a8 8 0 0 1 0-2.3L1.7 8.1l1.7-3 2.4.8a7.9 7.9 0 0 1 2-1.2z" },
  ];

  function configured() {
    return !!(window.SUPABASE_URL && window.SUPABASE_ANON_KEY && typeof window.supabase !== "undefined");
  }

  let _client = null;
  function client() {
    if (!configured()) return null;
    if (!_client) _client = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
    return _client;
  }

  /* ---------- Not-configured screen ---------- */
  function showNotConfigured() {
    document.body.innerHTML = `
      <div class="login-wrap">
        <div class="login-card" style="max-width:460px;">
          <div class="admin-brand"><span class="dot"></span>Shahedin Admin</div>
          <div class="notice" style="margin-bottom:0;">
            <strong>Not connected to Supabase yet.</strong><br><br>
            Open <code>js/supabase-config.js</code> in the project folder and paste in your
            Supabase Project URL and anon key (find them in your Supabase dashboard under
            Settings → API). Then reload this page.
          </div>
        </div>
      </div>`;
  }

  /* ---------- Auth guard: call at the top of every protected page ---------- */
  async function requireAdmin() {
    if (!configured()) {
      showNotConfigured();
      return null;
    }
    const c = client();
    const { data: { session } } = await c.auth.getSession();
    if (!session) {
      window.location.href = "login.html";
      return null;
    }
    const { data: adminRow, error } = await c.from("admins").select("id,email,full_name").eq("id", session.user.id).maybeSingle();
    if (error || !adminRow) {
      await c.auth.signOut();
      window.location.href = "login.html?denied=1";
      return null;
    }
    return adminRow;
  }

  /* ---------- Shell (sidebar + topbar) ---------- */
  function renderShell(activeHref, title, subtitle, admin) {
    const app = document.getElementById("adminApp");
    if (!app) return;
    const navHtml = NAV.map(
      (n) => `<a href="${n.href}" class="${n.href === activeHref ? "active" : ""}">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${n.icon}"/></svg>
        ${n.label}
      </a>`
    ).join("");

    app.innerHTML = `
      <div class="admin-shell">
        <aside class="admin-sidebar" id="adminSidebar">
          <div class="admin-brand"><span class="dot"></span>Shahedin<br><small>Admin Panel</small></div>
          <nav class="admin-nav">${navHtml}</nav>
          <div class="admin-sidebar-foot">
            <div class="admin-user">${admin ? (admin.full_name || admin.email) : ""}</div>
            <button class="admin-logout" id="logoutBtn">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>
              Log out
            </button>
          </div>
        </aside>
        <main class="admin-main">
          <div class="admin-topbar">
            <button class="icon-btn" id="mobileNavToggle" style="display:none;">☰</button>
            <div><h1>${title}</h1>${subtitle ? `<p>${subtitle}</p>` : ""}</div>
            <a href="../index.html" target="_blank" class="btn btn-ghost btn-sm">View site ↗</a>
          </div>
          <div class="admin-content" id="adminContent"></div>
        </main>
      </div>
      <div class="toast-wrap" id="toastWrap"></div>`;

    document.getElementById("logoutBtn").addEventListener("click", async () => {
      await client().auth.signOut();
      window.location.href = "login.html";
    });
  }

  /* ---------- Toasts ---------- */
  function toast(message, isError) {
    const wrap = document.getElementById("toastWrap");
    if (!wrap) return alert(message);
    const el = document.createElement("div");
    el.className = "toast" + (isError ? " err" : "");
    el.textContent = message;
    wrap.appendChild(el);
    setTimeout(() => el.remove(), 3800);
  }

  /* ---------- Field-level validation ----------
     Before this, a form either bounced off the browser's own generic
     "Please fill out this field" bubble, or went to the server and came back
     as one toast quoting a database column — "null value in column name_bn
     violates not-null constraint" — which never told the admin which of the
     fourteen boxes in front of them was wrong.

     validateFields marks the offending input red, writes the specific reason
     underneath it, scrolls to the first one, and returns the short labels of
     everything that failed so the caller can name them in a toast too. The
     error clears itself as soon as that field is edited, so a fixed field
     stops looking broken without needing another save attempt.

     Rules: { id, label, message, test? }. Default test is "not blank". */
  function clearFieldErrors(scope) {
    const root = scope || document;
    root.querySelectorAll(".is-invalid").forEach((el) => {
      el.classList.remove("is-invalid");
      el.removeAttribute("aria-invalid");
    });
    root.querySelectorAll(".field-error").forEach((el) => el.remove());
  }

  function showFieldError(el, message) {
    el.classList.add("is-invalid");
    el.setAttribute("aria-invalid", "true");
    const field = el.closest(".form-field") || el.parentElement;
    if (!field) return;
    let msg = field.querySelector(".field-error");
    if (!msg) {
      msg = document.createElement("p");
      msg.className = "field-error";
      field.appendChild(msg);
    }
    msg.textContent = message;
  }

  function validateFields(scope, rules) {
    clearFieldErrors(scope);
    const failed = [];

    rules.forEach((rule) => {
      const el = document.getElementById(rule.id);
      if (!el) return;
      const ok = rule.test ? rule.test(el.value, el) : String(el.value || "").trim() !== "";
      if (ok) return;

      failed.push(rule);
      showFieldError(el, rule.message);

      if (!el.dataset.errorWired) {
        el.dataset.errorWired = "1";
        const clear = () => {
          el.classList.remove("is-invalid");
          el.removeAttribute("aria-invalid");
          const field = el.closest(".form-field") || el.parentElement;
          const msg = field && field.querySelector(".field-error");
          if (msg) msg.remove();
        };
        el.addEventListener("input", clear);
        el.addEventListener("change", clear);
      }
    });

    if (failed.length) {
      const first = document.getElementById(failed[0].id);
      if (first) {
        if (typeof first.scrollIntoView === "function") first.scrollIntoView({ block: "center", behavior: "smooth" });
        first.focus({ preventScroll: true });
      }
    }
    return failed.map((r) => r.label);
  }

  // "Bangla name is missing." / "3 fields still need filling in: …"
  function missingSummary(labels) {
    if (labels.length === 1) return `${labels[0]} is missing.`;
    return `${labels.length} fields still need filling in: ${labels.join(", ")}.`;
  }

  /* ---------- Helpers ---------- */
  /* \w is ASCII-only in JavaScript, so the old version deleted every Bangla
     character and handed back "" for a Bangla title — which then failed the
     required check on a field labelled "auto-filled, only change if you know
     what it does". \p{L}\p{N} with the /u flag keeps letters and digits from
     any script, so "রাজনীতি ১০১" becomes "রাজনীতি-১০১". Browsers percent-encode
     that in the URL and display it back as Bangla, and every id is already
     passed through encodeURIComponent on the public side.

     \p{M} matters as much as \p{L} here: Bangla vowel signs (া ী ে, the
     matras) are combining MARKS, not letters, so keeping only \p{L}\p{N}
     silently gutted every word — "রাজনীতি" came out as "রজনত". */
  function slugify(text) {
    return (text || "")
      .toString()
      .toLowerCase()
      .trim()
      .replace(/[^\p{L}\p{N}\p{M}\s-]/gu, "")
      .replace(/[\s_-]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  // Never leave a required slug empty: a name of pure punctuation/emoji still
  // has to produce something saveable.
  function slugifyOrFallback(prefix, ...candidates) {
    for (const candidate of candidates) {
      const s = slugify(candidate);
      if (s) return s;
    }
    return `${prefix}-${Date.now().toString(36)}`;
  }

  /* Uploads anything to the public "media" bucket and returns its public URL.
     Every upload gets its own timestamped path (upsert:false) rather than
     overwriting a fixed filename — that's what lets the admin swap the media
     kit PDF whenever they like without a stale CDN copy being served, since
     the URL changes too. contentType is passed explicitly so a PDF is served
     as application/pdf and opens in the browser's viewer instead of
     downloading as an unnamed binary. */
  async function uploadFile(file, folder) {
    const c = client();
    const ext = (file.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
    const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await c.storage
      .from("media")
      .upload(path, file, { upsert: false, contentType: file.type || undefined });
    if (error) throw error;
    const { data } = c.storage.from("media").getPublicUrl(path);
    return data.publicUrl;
  }

  // Kept under its original name for the existing photo-upload call sites.
  const uploadImage = uploadFile;

  function timeAgo(iso) {
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60) return "just now";
    if (diff < 3600) return Math.floor(diff / 60) + "m ago";
    if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
    return Math.floor(diff / 86400) + "d ago";
  }

  function escapeHtml(str) {
    return (str || "").toString().replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  }

  return {
    configured, client, requireAdmin, renderShell, toast,
    slugify, slugifyOrFallback, uploadImage, uploadFile, timeAgo, escapeHtml, showNotConfigured,
    validateFields, clearFieldErrors, showFieldError, missingSummary,
  };
})();
