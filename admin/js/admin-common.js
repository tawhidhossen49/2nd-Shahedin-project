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

  /* The sidebar, in the groups a person thinks in rather than the order the
     pages were built. `key` is the page's permission name: it is what a main
     admin ticks on the Team page and what admin_can() checks in the
     database (schema.sql section 34). Two keys are special and are never
     stored: "dashboard" is open to every admin, "team" to main admins only. */
  const NAV_GROUPS = [
    { title: "", items: [
      { href: "index.html", key: "dashboard", label: "Dashboard", icon: "M4 4h7v9H4zM13 4h7v5h-7zM13 12h7v9h-7zM4 16h7v5H4z" },
    ] },
    { title: "Courses & store", items: [
      { href: "courses.html", key: "courses", label: "Courses", icon: "M4 19.5A2.5 2.5 0 0 1 6.5 17H20 M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" },
      { href: "products.html", key: "products", label: "Store products", icon: "M6 2 3 7v13a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V7l-3-5H6zM3 7h18M16 11a4 4 0 0 1-8 0" },
      { href: "coupons.html", key: "coupons", label: "Discount coupons", icon: "M20 12a2 2 0 0 1 2-2V7a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v3a2 2 0 0 1 0 4v3a1 1 0 0 0 1 1h18a1 1 0 0 0 1-1v-3a2 2 0 0 1-2-2zM13 7v2M13 15v2" },
      { href: "reviews.html", key: "reviews", label: "Course reviews", icon: "M12 2l2.9 6.3 6.9.9-5 4.9 1.2 6.9-6-3.2-6 3.2 1.2-6.9-5-4.9 6.9-.9z" },
    ] },
    { title: "People & sales", items: [
      { href: "orders.html", key: "orders", label: "Orders & payments", icon: "M9 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM19 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6" },
      { href: "students.html", key: "students", label: "Students", icon: "M12 2 1 7l11 5 9-4.1V17h2V7zM5 13.2V17c0 2 3.1 4 7 4s7-2 7-4v-3.8l-7 3.2z" },
      { href: "submissions.html", key: "submissions", label: "Contact messages", icon: "M4 4h16v16H4zM4 6l8 6 8-6" },
      { href: "analytics.html", key: "analytics", label: "Visitor analytics", icon: "M4 19V5M4 19h16M9 19V9M14 19v-6M19 19V6" },
      { href: "ads.html", key: "ads", label: "Facebook ads", icon: "M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" },
    ] },
    { title: "Website content", items: [
      { href: "home.html", key: "home", label: "Homepage", icon: "M3 11l9-8 9 8M5 10v10h14V10" },
      { href: "portfolio.html", key: "portfolio", label: "Portfolio page", icon: "M4 19V5M4 19h16M9 19V9M14 19v-6M19 19V6" },
      { href: "community.html", key: "community", label: "Community links", icon: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" },
      { href: "legal.html", key: "legal", label: "Terms & privacy", icon: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h5" },
      { href: "settings.html", key: "settings", label: "Contact & social links", icon: "M10.3 2.3h3.4l.6 2.4a7.9 7.9 0 0 1 2 1.2l2.4-.8 1.7 3-1.9 1.6a8 8 0 0 1 0 2.3l1.9 1.6-1.7 3-2.4-.8a7.9 7.9 0 0 1-2 1.2l-.6 2.4h-3.4l-.6-2.4a7.9 7.9 0 0 1-2-1.2l-2.4.8-1.7-3 1.9-1.6a8 8 0 0 1 0-2.3L1.7 8.1l1.7-3 2.4.8a7.9 7.9 0 0 1 2-1.2z" },
    ] },
    { title: "Team", items: [
      { href: "team.html", key: "team", label: "Team & access", icon: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM19 8v6M22 11h-6" },
    ] },
  ];
  const NAV = NAV_GROUPS.reduce((all, g) => all.concat(g.items), []);

  /* The pages a partial admin can be given, with the one line the Team page
     shows beside each tick box. Same keys as admin_page_keys() in
     schema.sql. */
  const PAGES = [
    { key: "courses", label: "Courses", desc: "Add and edit courses, lessons and prices." },
    { key: "products", label: "Store products", desc: "Add and edit the books, notes and other items in the store." },
    { key: "coupons", label: "Discount coupons", desc: "Create and switch off discount codes." },
    { key: "reviews", label: "Course reviews", desc: "Approve, hide or delete what students wrote." },
    { key: "orders", label: "Orders & payments", desc: "See every payment and send refunds." },
    { key: "students", label: "Students", desc: "See who signed up, and give or remove course access by hand." },
    { key: "submissions", label: "Contact messages", desc: "Read and delete messages sent from the Contact page." },
    { key: "analytics", label: "Visitor analytics", desc: "See how many people visit each page." },
    { key: "ads", label: "Facebook ads", desc: "Turn Facebook ad tracking (Meta Pixel) on or off and check it works." },
    { key: "home", label: "Homepage", desc: "Edit the text, photos and sections of the homepage." },
    { key: "portfolio", label: "Portfolio page", desc: "Edit the portfolio page and its numbers." },
    { key: "community", label: "Community links", desc: "Edit the community group links students see." },
    { key: "legal", label: "Terms & privacy", desc: "Edit the Terms and Privacy pages." },
    { key: "settings", label: "Contact & social links", desc: "Edit the phone, email, WhatsApp and social links." },
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
    /* role + permissions arrive with schema.sql section 34. A database that
       has not run it yet has neither column, and the query fails on the
       column name rather than returning a row. That is not "not an admin":
       fall back to the old three columns and treat the admin exactly as the
       panel always has -- everything allowed -- so deploying this file ahead
       of the schema change locks nobody out. */
    let { data: adminRow, error } = await c.from("admins").select("id,email,full_name,role,permissions").eq("id", session.user.id).maybeSingle();
    let legacy = false;
    if (error && (error.code === "42703" || error.code === "PGRST204" || /column/i.test(error.message || ""))) {
      legacy = true;
      ({ data: adminRow, error } = await c.from("admins").select("id,email,full_name").eq("id", session.user.id).maybeSingle());
    }
    if (error || !adminRow) {
      await c.auth.signOut();
      window.location.href = "login.html?denied=1";
      return null;
    }
    if (legacy) {
      adminRow.role = "main";
      adminRow.permissions = [];
      adminRow.legacy = true;
    }
    if (!Array.isArray(adminRow.permissions)) adminRow.permissions = [];
    _admin = adminRow;

    /* Which page is this? Every admin page calls requireAdmin() first, so the
       check lives here once instead of in fifteen files. Opening a page you
       were not given sends you to the dashboard with a plain explanation.
       This is a courtesy, not the lock: the database refuses the data either
       way (admin_can() in schema.sql). */
    const here = pageFromLocation();
    if (here && !can(here.key)) {
      window.location.replace("index.html?noaccess=" + encodeURIComponent(here.label));
      return null;
    }
    return adminRow;
  }

  let _admin = null;

  function pageFromLocation() {
    const file = (window.location.pathname.split("/").pop() || "index.html").toLowerCase() || "index.html";
    return NAV.find((n) => n.href === file) || null;
  }

  /* May the signed-in admin use this page? "dashboard" is everyone's landing
     page. "team" is where access itself is handed out, so main admins only. */
  function can(key) {
    if (!_admin) return false;
    if (key === "dashboard") return true;
    if (_admin.role === "main") return true;
    if (key === "team") return false;
    return _admin.permissions.includes(key);
  }

  function isMain() {
    return !!_admin && _admin.role === "main";
  }

  /* ---------- Shell (sidebar + topbar) ---------- */
  function renderShell(activeHref, title, subtitle, admin) {
    const app = document.getElementById("adminApp");
    if (!app) return;
    /* Only the pages this admin may open. A group with nothing left in it
       loses its heading too, so a one-page admin sees one link, not five
       empty headings. */
    const navHtml = NAV_GROUPS.map((group) => {
      const links = group.items.filter((n) => can(n.key)).map(
        (n) => `<a href="${n.href}" class="${n.href === activeHref ? "active" : ""}"${n.href === activeHref ? ' aria-current="page"' : ""}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${n.icon}"/></svg>
        ${n.label}
      </a>`
      ).join("");
      if (!links) return "";
      return (group.title ? `<div class="admin-nav-group">${group.title}</div>` : "") + links;
    }).join("");
    const roleLabel = admin ? (admin.role === "main" ? "Main admin" : "Limited access") : "";
    /* The heading says the same words as the menu link that opened the page.
       Each page still passes its own title, and it is used when the page is
       not in the menu, but "Orders" in the menu and "Orders & payments" at
       the top would look like two different places. */
    const navItem = NAV.find((n) => n.href === activeHref);
    const heading = navItem ? navItem.label : title;

    app.innerHTML = `
      <div class="admin-shell">
        <aside class="admin-sidebar" id="adminSidebar">
          <div class="admin-brand"><span class="dot"></span>Shahedin<br><small>Admin Panel</small></div>
          <nav class="admin-nav">${navHtml}</nav>
          <div class="admin-sidebar-foot">
            <div class="admin-user">${admin ? escapeHtml(admin.full_name || admin.email) : ""}${roleLabel ? `<span class="admin-role">${roleLabel}</span>` : ""}</div>
            <button class="admin-logout" id="logoutBtn">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>
              Log out
            </button>
          </div>
        </aside>
        <main class="admin-main">
          <div class="admin-topbar">
            <button class="icon-btn" id="mobileNavToggle" type="button" aria-label="Menu" aria-expanded="false" aria-controls="adminSidebar">☰</button>
            <div><h1>${heading}</h1>${subtitle ? `<p>${subtitle}</p>` : ""}</div>
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

    /* Mobile sidebar. Below 860px admin.css moves .admin-sidebar off-canvas
       and only .open brings it back, but nothing ever added that class and
       the toggle was rendered display:none -- so on a phone you could see the
       page you landed on and reach none of the others. CSS handles when the
       button is visible; this handles what it does. */
    const sidebar = document.getElementById("adminSidebar");
    const toggle = document.getElementById("mobileNavToggle");
    if (sidebar && toggle) {
      const scrim = document.createElement("div");
      scrim.className = "admin-scrim";
      document.body.appendChild(scrim);

      const setOpen = (open) => {
        sidebar.classList.toggle("open", open);
        scrim.classList.toggle("show", open);
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
        // Stops the page behind scrolling under the open drawer.
        document.body.style.overflow = open ? "hidden" : "";
      };

      toggle.addEventListener("click", () => setOpen(!sidebar.classList.contains("open")));
      scrim.addEventListener("click", () => setOpen(false));
      document.addEventListener("keydown", (e) => { if (e.key === "Escape") setOpen(false); });
      // Following a link should not leave the drawer covering the new page.
      sidebar.querySelectorAll("a").forEach((a) => a.addEventListener("click", () => setOpen(false)));
    }

    watchTables();
  }

  /* ---------- Responsive tables ----------
     Below 760px admin.css turns every table row into a stacked card, which
     needs each cell to know which column it came from. Rather than hand-
     writing data-label into eight different render functions (and remembering
     to do it in the ninth), the header text is copied down automatically.

     Runs off a MutationObserver because tables are painted by innerHTML at
     unpredictable times. Only childList is observed, and this writes
     attributes, so it cannot retrigger itself. */
  function labelTable(table) {
    const heads = Array.from(table.querySelectorAll("thead th")).map((th) => th.textContent.trim());
    if (!heads.length) return;
    table.querySelectorAll("tbody tr").forEach((tr) => {
      Array.from(tr.children).forEach((cell, i) => {
        // An empty header means an unlabelled column (the row-actions one);
        // the CSS gives those the full width instead of a label gutter.
        cell.setAttribute("data-label", heads[i] || "");
      });
    });
  }

  function labelTables(root) {
    (root || document).querySelectorAll(".admin-table").forEach(labelTable);
  }

  function watchTables() {
    const content = document.getElementById("adminContent");
    if (!content) return;
    labelTables(content);
    if (!("MutationObserver" in window)) return;
    let queued = false;
    new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; labelTables(content); });
    }).observe(content, { childList: true, subtree: true });
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

  /* ---------- Unsaved-changes guard ----------
     The big editors open in a pop-up over a dark backdrop, and one stray
     click on that backdrop used to close the pop-up and throw away whatever
     had been typed -- a whole course, sometimes. trackChanges() watches a
     form and remembers whether anything in it was touched; confirmDiscard()
     asks before closing, but only when there is something to lose.

     Typing and ticking count, and so do the form's own buttons (add a
     lesson, remove a point, pick a colour), because those change what would
     be saved without firing an input event. A button marked data-no-dirty
     -- Cancel, the section jump links -- does not. */
  function trackChanges(form) {
    let dirty = false;
    if (form) {
      const mark = () => { dirty = true; };
      form.addEventListener("input", mark);
      form.addEventListener("change", mark);
      form.addEventListener("click", (e) => {
        const btn = e.target.closest("button");
        if (btn && btn.type !== "submit" && !btn.hasAttribute("data-no-dirty")) dirty = true;
      });
    }
    return { isDirty: () => dirty };
  }

  function confirmDiscard(tracker) {
    if (!tracker || !tracker.isDirty()) return true;
    return confirm("Close without saving?\n\nThe changes you made here will be lost.");
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
  /* Supabase enforces a per-file ceiling on the storage API, and on the free
     plan it is 50 MB. Hitting it server-side means uploading the whole file
     first and then being told no, which on a phone connection is minutes of
     progress bar for a rejection -- and the raw reply is a bare 413 that says
     nothing about what to do instead. Checked here so an oversized file is
     refused instantly, in words, with the way round it.

     Raising this alone achieves nothing: the limit lives in the platform, not
     in this number. Keep the two in step if the plan changes.
     Storage > Settings > "Upload file size limit" in the dashboard. */
  const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

  async function uploadFile(file, folder) {
    if (file && file.size > MAX_UPLOAD_BYTES) {
      const mb = Math.ceil(file.size / (1024 * 1024));
      throw new Error(
        `That file is ${mb} MB and the limit is 50 MB. For a video this long, ` +
        `put it on YouTube (an unlisted video works) and paste the link into the ` +
        `box above instead — there is no size limit that way, it costs you no ` +
        `storage, and it streams far better on a phone.`
      );
    }
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
    can, isMain, PAGES, trackChanges, confirmDiscard,
    slugify, slugifyOrFallback, uploadImage, uploadFile, timeAgo, escapeHtml, showNotConfigured,
    validateFields, clearFieldErrors, showFieldError, missingSummary,
  };
})();
