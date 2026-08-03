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

  /* ---------- Helpers ---------- */
  function slugify(text) {
    return (text || "")
      .toString()
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, "")
      .replace(/[\s_-]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  async function uploadImage(file, folder) {
    const c = client();
    const ext = file.name.split(".").pop();
    const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await c.storage.from("media").upload(path, file, { upsert: false });
    if (error) throw error;
    const { data } = c.storage.from("media").getPublicUrl(path);
    return data.publicUrl;
  }

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

  return { configured, client, requireAdmin, renderShell, toast, slugify, uploadImage, timeAgo, escapeHtml, showNotConfigured };
})();
