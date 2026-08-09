/* =========================================================
   dashboard.js
   ---------------------------------------------------------
   Fully data-driven student dashboard: real login/signup gate,
   real enrolled courses + progress, real resources aggregated
   from course content, real certificates, real order history,
   and a real (working) settings form.
   ========================================================= */
(function () {
  "use strict";

  const TABS = [
    { id: "overview", label: "ওভারভিউ", icon: "M3 11l9-8 9 8M5 10v10h14V10" },
    { id: "courses", label: "আমার কোর্স", icon: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z" },
    { id: "resources", label: "রিসোর্স", icon: "M12 3v12m0 0 4-4m-4 4-4-4M4 19h16" },
    { id: "community", label: "কমিউনিটি", icon: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" },
    { id: "certificates", label: "সার্টিফিকেট", icon: "M12 8a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM9 13l-2 8 5-3 5 3-2-8" },
    { id: "orders", label: "অর্ডার", icon: "M9 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM19 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6" },
    { id: "settings", label: "সেটিংস", icon: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" },
  ];

  function escapeHtml(str) {
    return (str == null ? "" : String(str)).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  }

  const app = document.getElementById("dashApp");
  if (!app) return;

  let state = { user: null, profile: null, community: null, enrollments: [], courses: [], orders: [], products: [] };

  async function init() {
    if (!window.ShahedinAuth || !window.ShahedinAuth.configured()) {
      app.innerHTML = `
        <div class="dash-main dash-centered">
          <div class="notice">সাইটটি এখনো Supabase-এর সাথে সংযুক্ত নয়, তাই অ্যাকাউন্ট ও ড্যাশবোর্ড এখন কাজ করবে না। <code>js/supabase-config.js</code>-এ আপনার Supabase তথ্য যোগ করুন।</div>
        </div>`;
      return;
    }

    const user = await window.ShahedinAuth.getUser();
    if (!user) {
      renderLoggedOut();
      return;
    }
    state.user = user;
    await loadData();
    renderShell();
    handlePurchaseToast();

    window.ShahedinAuth.onChange((u) => {
      if (!u) window.location.reload();
    });
  }

  function renderLoggedOut() {
    app.innerHTML = `
      <div class="dash-main dash-centered dash-centered-narrow">
        <div class="modal modal-inline">
          <div class="auth-modal-brand"><span class="dot"></span>Shahedin</div>
          <p class="dash-auth-note">আপনার কোর্স ও অগ্রগতি দেখতে লগ ইন করুন।</p>
          <div id="dashAuthForm"></div>
        </div>
      </div>`;
    window.ShahedinAuth.renderAuthForm(document.getElementById("dashAuthForm"), {
      onSuccess: () => window.location.reload(),
    });
  }

  async function loadData() {
    const c = window.ShahedinAuth.client();
    const [enrollRes, orderRes, profileRes, communityRes] = await Promise.all([
      c.from("enrollments").select("*").eq("user_id", state.user.id).order("enrolled_at", { ascending: false }),
      c.from("orders").select("*").eq("user_id", state.user.id).order("created_at", { ascending: false }),
      // The student's own profile row, so the Settings form opens pre-filled.
      // maybeSingle: a brand-new account may not have its trigger-created row
      // visible yet, and a missing profile must not break the dashboard.
      c.from("profiles").select("*").eq("id", state.user.id).maybeSingle(),
      // Community links, managed from Admin -> Community.
      c.from("site_settings").select("value").eq("key", "community").maybeSingle(),
    ]);
    state.enrollments = enrollRes.data || [];
    state.orders = orderRes.data || [];
    state.profile = (profileRes && profileRes.data) || null;
    state.community = (communityRes && communityRes.data && communityRes.data.value) || null;

    /* courses_safe, NOT courses. The raw `courses` table has no public read
       policy at all — only "admins can read all courses" — so this query
       returned zero rows for every student, and the whole dashboard silently
       behaved as if they owned nothing: blank "আমার কোর্স", 0% progress,
       no resources, no certificates. courses_safe is granted to
       authenticated and, for a course the student is enrolled in, hands back
       the full content_blocks array, which is what progressFor() counts.
       (It only returns published courses — see courseFor's callers for how a
       course that disappears mid-enrolment is reported.) */
    const courseIds = state.enrollments.map((e) => e.course_id);
    if (courseIds.length) {
      const { data: courses, error } = await c.from("courses_safe").select("*").in("id", courseIds);
      if (error) console.warn("Shahedin dashboard: couldn't load course details.", error);
      state.courses = courses || [];
    } else {
      state.courses = [];
    }

    /* Digital products this student has bought. products_safe returns
       delivery_url only to someone with a completed order for that product,
       so simply asking for it here is the whole access check. */
    const productIds = [...new Set(state.orders.filter((o) => o.kind === "product").map((o) => o.item_id))];
    if (productIds.length) {
      const { data: products, error } = await c.from("products_safe").select("*").in("id", productIds);
      if (error) console.warn("Shahedin dashboard: couldn't load purchased products.", error);
      state.products = products || [];
    } else {
      state.products = [];
    }
  }

  function productFor(order) {
    return state.products.find((p) => p.id === order.item_id);
  }

  /* Everything the student has bought that actually has something to download.
     Deduplicated by product, because buying the same PDF twice should not
     produce two identical download rows. */
  function purchasedDownloads() {
    const seen = new Set();
    const out = [];
    state.orders.forEach((o) => {
      if (o.kind !== "product" || o.status !== "completed") return;
      const p = productFor(o);
      if (!p || !p.delivery_url || seen.has(p.id)) return;
      seen.add(p.id);
      out.push({ product: p, order: o });
    });
    return out;
  }

  function courseFor(enrollment) {
    return state.courses.find((c) => c.id === enrollment.course_id);
  }

  function progressFor(enrollment) {
    const course = courseFor(enrollment);
    const blocks = course && Array.isArray(course.content_blocks) ? course.content_blocks : [];
    const total = blocks.length;
    const completed = Array.isArray(enrollment.completed_blocks) ? enrollment.completed_blocks : [];
    const done = completed.length;

    /* Partial credit for a video the student is midway through. Without it the
       bar only moves when a whole lesson finishes, so someone forty minutes
       into an hour-long lecture sees the same number as someone who has not
       pressed play. `done` stays a whole-item count for the "৩/৫ আইটেম" label;
       only the percentage is fractional. */
    const watch = enrollment.block_progress || {};
    let credit = 0;
    blocks.forEach((b) => {
      if (completed.includes(b.id)) { credit += 1; return; }
      const p = watch[b.id];
      if (p && p.pct > 0) credit += Math.min(1, p.pct / 100);
    });

    const pct = total ? Math.min(100, Math.round((credit / total) * 100)) : 0;
    return { total, done, pct };
  }

  /* Every tab used to do `.filter((x) => x.c)` and then treat what was left as
     the whole truth. When course details failed to load, that turned "we
     couldn't read your courses" into "you have no courses in progress" — which
     the Overview tab then rendered as "all your courses are complete, well
     done!" to a student sitting at 0%. Splitting the list here means a tab can
     tell the difference between *finished*, *none yet*, and *couldn't load*,
     and none of them can be mistaken for another. */
  function enrollmentRows() {
    const rows = state.enrollments.map((e) => ({ e, p: progressFor(e), c: courseFor(e) }));
    const known = rows.filter((x) => x.c);
    return { rows, known, missing: rows.length - known.length };
  }

  function unavailableHTML(count) {
    return `<div class="empty-state"><p>আপনার ${bn(count)}টি কোর্সের তথ্য এই মুহূর্তে লোড করা যাচ্ছে না। কোর্সটি হয়তো সাময়িকভাবে সরিয়ে রাখা হয়েছে — একটু পরে আবার চেষ্টা করুন বা <a class="text-link" href="contact.html">আমাদের জানান</a>।</p></div>`;
  }

  // Bangla numerals, so the dashboard's figures match the rest of the site.
  function bn(n) {
    return String(n).replace(/[0-9]/g, (d) => "০১২৩৪৫৬৭৮৯"[+d]);
  }

  function stats() {
    const { known, rows } = enrollmentRows();
    const enrolledCount = rows.length;
    const progresses = known.map((x) => x.p);
    // Averaged over courses we could actually measure — counting an unreadable
    // course as 0% would understate real progress.
    const avgProgress = progresses.length ? Math.round(progresses.reduce((s, p) => s + p.pct, 0) / progresses.length) : 0;
    const certificatesCount = progresses.filter((p) => p.total > 0 && p.done >= p.total).length;

    let resourcesCount = 0;
    state.enrollments.forEach((e) => {
      const course = courseFor(e);
      if (!course || !Array.isArray(course.content_blocks)) return;
      const completed = Array.isArray(e.completed_blocks) ? e.completed_blocks : [];
      course.content_blocks.forEach((b) => {
        if ((b.type === "resource" || b.type === "pdf") && completed.includes(b.id)) resourcesCount++;
      });
    });

    return { enrolledCount, avgProgress, resourcesCount, certificatesCount };
  }

  function renderShell() {
    const hash = (window.location.hash || "#overview").slice(1);
    const activeTab = TABS.some((t) => t.id === hash) ? hash : "overview";

    app.innerHTML = `
      <div class="dash-shell">
        <aside class="dash-side">
          ${TABS.map((t) => `
            <a href="#${t.id}" class="side-link ${t.id === activeTab ? "active" : ""}" data-tab-link="${t.id}">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="${t.icon}"/></svg>
              <span>${t.label}</span>
            </a>`).join("")}
          <button type="button" class="side-link side-link-signout" id="dashSignOut">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>
            <span>লগ আউট</span>
          </button>
        </aside>
        <main class="dash-main" id="dashMain"></main>
      </div>`;

    app.querySelectorAll("[data-tab-link]").forEach((link) => {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        window.location.hash = link.dataset.tabLink;
        app.querySelectorAll("[data-tab-link]").forEach((l) => l.classList.remove("active"));
        link.classList.add("active");
        renderTab(link.dataset.tabLink);
      });
    });
    document.getElementById("dashSignOut").addEventListener("click", async () => {
      await window.ShahedinAuth.signOut();
      window.location.href = "index.html";
    });

    renderTab(activeTab);
  }

  function renderTab(tab) {
    const main = document.getElementById("dashMain");
    if (tab === "overview") return renderOverview(main);
    if (tab === "courses") return renderCourses(main);
    if (tab === "resources") return renderResources(main);
    if (tab === "community") return renderCommunity(main);
    if (tab === "certificates") return renderCertificates(main);
    if (tab === "orders") return renderOrders(main);
    if (tab === "settings") return renderSettings(main);
  }

  function renderOverview(main) {
    const s = stats();
    const name = window.ShahedinAuth.displayName(state.user);
    const { rows, known, missing } = enrollmentRows();
    const inProgress = known.filter((x) => x.p.pct < 100).slice(0, 3);

    main.innerHTML = `
      <h1 class="dash-greeting"><span>স্বাগতম</span>, ${escapeHtml(name)}</h1>
      <p class="dash-greeting-sub">আপনি যেখানে রেখেছিলেন সেখান থেকে শুরু করুন।</p>
      <div class="grid grid-4 dash-stat-row reveal-stagger">
        <div class="stat-mini"><div class="n">${s.enrolledCount}</div><div class="l">ভর্তি হওয়া কোর্স</div></div>
        <div class="stat-mini"><div class="n">${s.avgProgress}%</div><div class="l">গড় অগ্রগতি</div></div>
        <div class="stat-mini"><div class="n">${s.resourcesCount}</div><div class="l">সংরক্ষিত রিসোর্স</div></div>
        <div class="stat-mini"><div class="n">${s.certificatesCount}</div><div class="l">অর্জিত সার্টিফিকেট</div></div>
      </div>
      <h2 class="dash-section-title">চলমান কোর্স</h2>
      <div id="overviewCourses"></div>`;

    const wrap = document.getElementById("overviewCourses");
    if (!inProgress.length) {
      // Three genuinely different situations, three different answers. The
      // "all complete" line is now only reachable when courses actually loaded
      // AND every one of them really is at 100%.
      if (!rows.length) {
        wrap.innerHTML = `<div class="empty-state"><p>এখনো কোনো কোর্সে ভর্তি হননি। <a class="text-link" href="courses.html">কোর্স ব্রাউজ করুন →</a></p></div>`;
      } else if (!known.length) {
        wrap.innerHTML = unavailableHTML(rows.length);
      } else {
        wrap.innerHTML = `<div class="empty-state"><p>আপনার সব কোর্স সম্পন্ন হয়েছে — দারুণ! <a class="text-link" href="courses.html">আরও কোর্স দেখুন →</a></p></div>`;
      }
      return;
    }
    wrap.innerHTML = inProgress.map((x) => courseRowHTML(x.c, x.p)).join("") + (missing ? unavailableHTML(missing) : "");
  }

  function courseRowHTML(course, p) {
    const image = course.thumbnail_url ? `background-image:url('${course.thumbnail_url}');background-size:cover;background-position:center;` : "";
    return `
      <div class="dash-course-row">
        <div class="dthumb thumb thumb-tone-${course.tone || 1}${course.thumbnail_url ? " has-image" : ""}" style="${image}"></div>
        <div class="dinfo">
          <h3>${escapeHtml(course.title_bn || course.title_en)}</h3>
          <div class="progress-track"><div class="progress-fill" style="width:${p.pct}%;"></div></div>
          <div class="small-note dash-progress-note">${p.pct}% সম্পন্ন${p.total ? ` · ${p.done}/${p.total} আইটেম` : ""}</div>
        </div>
        <a href="course-detail.html?id=${encodeURIComponent(course.slug)}" class="btn btn-ghost btn-sm">চালিয়ে যান</a>
      </div>`;
  }

  function renderCourses(main) {
    main.innerHTML = `<h1 class="dash-page-title">আমার কোর্স</h1><div id="allCourses"></div>`;
    const wrap = document.getElementById("allCourses");
    if (!state.enrollments.length) {
      wrap.innerHTML = `<div class="empty-state"><p>এখনো কোনো কোর্সে ভর্তি হননি। <a class="text-link" href="courses.html">কোর্স ব্রাউজ করুন →</a></p></div>`;
      return;
    }
    // This used to filter out every enrolment whose course details were
    // missing, which could leave the page as a bare heading with nothing
    // under it. Anything unreadable is now counted and reported instead.
    const { known, missing } = enrollmentRows();
    wrap.innerHTML =
      known.map((x) => courseRowHTML(x.c, x.p)).join("") + (missing ? unavailableHTML(missing) : "");
  }

  /* One row per downloadable thing. `download` is set for uploaded files so
     the browser saves them instead of navigating away; it is ignored on a
     cross-origin URL, where target="_blank" keeps the dashboard open. */
  function downloadRowHTML(opts) {
    return `
      <div class="res-row res-row-buy">
        <div class="rleft">
          <span class="res-icon" aria-hidden="true">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m0 0 4-4m-4 4-4-4M4 19h16"/></svg>
          </span>
          <span>
            ${escapeHtml(opts.title)}
            <span class="small-note">${escapeHtml(opts.sub)}</span>
            ${opts.note ? `<span class="small-note res-note">${escapeHtml(opts.note)}</span>` : ""}
          </span>
        </div>
        <a href="${escapeHtml(opts.url)}" target="_blank" rel="noopener" ${opts.isFile ? "download" : ""}
           class="btn btn-primary btn-sm">${escapeHtml(opts.label)}</a>
      </div>`;
  }

  function purchasedDownloadHTML(entry) {
    const p = entry.product;
    return downloadRowHTML({
      title: p.name_bn || p.name_en,
      sub: "কেনা প্রোডাক্ট",
      note: p.delivery_note || "",
      url: p.delivery_url,
      label: p.delivery_label || (p.delivery_type === "link" ? "খুলুন" : "ডাউনলোড করুন"),
      isFile: p.delivery_type === "file",
    });
  }

  function renderResources(main) {
    main.innerHTML = `<h1 class="dash-page-title">রিসোর্স</h1><div id="resList"></div>`;
    const wrap = document.getElementById("resList");
    const bought = purchasedDownloads();
    const items = [];
    state.enrollments.forEach((e) => {
      const course = courseFor(e);
      if (!course || !Array.isArray(course.content_blocks)) return;
      course.content_blocks.forEach((b) => {
        if (b.type === "resource" || b.type === "pdf") {
          items.push({ block: b, courseTitle: course.title_bn || course.title_en, url: b.type === "pdf" ? b.pdf_url : b.url });
        }
      });
    });

    if (!items.length && !bought.length) {
      wrap.innerHTML = `<div class="empty-state"><p>এখানে আপনার কেনা ডিজিটাল প্রোডাক্ট এবং ভর্তি হওয়া কোর্সের রিসোর্স দেখা যাবে।</p></div>`;
      return;
    }

    // Bought products first: someone who just paid is looking for that file,
    // not for a reading list from a course they enrolled in weeks ago.
    wrap.innerHTML =
      (bought.length
        ? `<h2 class="dash-section-title">আপনার কেনা প্রোডাক্ট</h2>${bought.map(purchasedDownloadHTML).join("")}`
        : "") +
      (items.length
        ? `${bought.length ? `<h2 class="dash-section-title">কোর্সের রিসোর্স</h2>` : ""}${items
            .map(
              (it) => `
      <div class="res-row">
        <div class="rleft">
          <span class="res-icon" aria-hidden="true">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
          </span>
          <span>${escapeHtml(it.block.title)} <span class="small-note">${escapeHtml(it.courseTitle)}</span></span>
        </div>
        ${it.url ? `<a href="${escapeHtml(it.url)}" target="_blank" rel="noopener" class="btn btn-ghost btn-sm">দেখুন</a>` : `<span class="small-note">লিংক নেই</span>`}
      </div>`
            )
            .join("")}`
        : "");
  }

  /* Brand marks for the platforms a Bangladeshi creator community actually
     runs on. Drawn inline to match the rest of the site, which has no icon
     dependency. "link" is the fallback for anything else. */
  const COMMUNITY_ICONS = {
    discord: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.32 4.57A19.8 19.8 0 0 0 15.43 3c-.21.38-.46.9-.63 1.31a18.3 18.3 0 0 0-5.6 0C9.03 3.9 8.78 3.38 8.56 3a19.7 19.7 0 0 0-4.89 1.57C.57 9.2-.26 13.7.16 18.14a19.9 19.9 0 0 0 6.03 3.06c.49-.67.92-1.38 1.3-2.13-.71-.27-1.4-.6-2.04-.99.17-.13.34-.26.5-.4a14.2 14.2 0 0 0 12.1 0c.17.14.33.27.5.4-.65.39-1.33.72-2.05 1 .37.74.8 1.45 1.3 2.12a19.9 19.9 0 0 0 6.04-3.06c.5-5.15-.84-9.6-3.52-13.57zM8.02 15.44c-1.18 0-2.15-1.09-2.15-2.42 0-1.34.95-2.43 2.15-2.43s2.17 1.1 2.15 2.43c0 1.33-.95 2.42-2.15 2.42zm7.96 0c-1.18 0-2.15-1.09-2.15-2.42 0-1.34.95-2.43 2.15-2.43s2.17 1.1 2.15 2.43c0 1.33-.94 2.42-2.15 2.42z"/></svg>',
    telegram: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 0C5.37 0 0 5.37 0 12s5.37 12 12 12 12-5.37 12-12S18.63 0 12 0zm5.56 8.22-1.86 8.77c-.14.62-.51.77-1.03.48l-2.85-2.1-1.37 1.32c-.15.15-.28.28-.58.28l.21-2.93 5.34-4.83c.23-.2-.05-.32-.36-.12L8.46 13.3l-2.84-.89c-.62-.19-.63-.62.13-.92l11.1-4.28c.51-.19.96.12.71 1.01z"/></svg>',
    facebook: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13.5 22v-8.4h2.8l.4-3.3h-3.2V8.1c0-1 .3-1.6 1.7-1.6h1.7V3.5c-.3 0-1.4-.1-2.6-.1-2.6 0-4.4 1.6-4.4 4.5v2.5H7v3.3h2.9V22z"/></svg>',
    whatsapp: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.16-.17.2-.35.22-.64.08-.3-.15-1.26-.47-2.4-1.48-.88-.79-1.48-1.76-1.65-2.06-.17-.3-.02-.46.13-.6.13-.14.3-.35.44-.52.15-.18.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.61-.92-2.21-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.87 1.21 3.07c.15.2 2.1 3.2 5.08 4.49.71.3 1.26.49 1.69.62.71.23 1.36.2 1.87.12.57-.09 1.76-.72 2-1.42.25-.69.25-1.29.18-1.41-.08-.13-.28-.2-.57-.35z"/><path d="M20.52 3.45A11.82 11.82 0 0 0 12.05 0C5.5 0 .16 5.34.16 11.89c0 2.1.55 4.14 1.59 5.95L.06 24l6.3-1.65a11.88 11.88 0 0 0 5.69 1.45c6.55 0 11.89-5.34 11.89-11.9a11.82 11.82 0 0 0-3.42-8.45zm-8.47 18.3a9.87 9.87 0 0 1-5.03-1.38l-.36-.22-3.74.99 1-3.65-.24-.37a9.86 9.86 0 0 1-1.51-5.26c0-5.45 4.44-9.89 9.89-9.89a9.83 9.83 0 0 1 9.88 9.9c0 5.45-4.43 9.88-9.89 9.88z"/></svg>',
    youtube: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M22.5 6.2a2.8 2.8 0 0 0-2-2C18.9 3.7 12 3.7 12 3.7s-6.9 0-8.5.5a2.8 2.8 0 0 0-2 2A29 29 0 0 0 1 12a29 29 0 0 0 .5 5.8 2.8 2.8 0 0 0 2 2c1.6.5 8.5.5 8.5.5s6.9 0 8.5-.5a2.8 2.8 0 0 0 2-2A29 29 0 0 0 23 12a29 29 0 0 0-.5-5.8zM9.8 15.5v-7l6 3.5z"/></svg>',
    link: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>',
  };

  function renderCommunity(main) {
    const data = state.community || {};
    const links = Array.isArray(data.links) ? data.links.filter((l) => l && l.url && l.label) : [];

    main.innerHTML = `
      <h1 class="dash-page-title">${escapeHtml(data.title || "কমিউনিটি")}</h1>
      <p class="dash-greeting-sub">${escapeHtml(data.intro || "অন্য শিক্ষার্থীদের সাথে যুক্ত হোন, প্রশ্ন করুন এবং আপডেট পান।")}</p>
      <div id="communityList" class="community-grid"></div>`;

    const wrap = document.getElementById("communityList");
    if (!links.length) {
      wrap.innerHTML = `<div class="empty-state"><p>কমিউনিটি লিংক এখনো যোগ করা হয়নি। খুব শীঘ্রই এখানে যুক্ত হবে।</p></div>`;
      return;
    }

    wrap.innerHTML = links
      .map((l) => {
        const icon = COMMUNITY_ICONS[l.platform] || COMMUNITY_ICONS.link;
        // Only real web destinations. A bad row can't turn a card into a
        // javascript: URL just because someone pasted one into the admin box.
        const href = /^https?:\/\/\S+$/i.test(String(l.url || "").trim()) ? l.url.trim() : "";
        if (!href) return "";
        return `
        <a class="community-card" href="${escapeHtml(href)}" target="_blank" rel="noopener">
          <span class="community-icon community-${escapeHtml(l.platform || "link")}">${icon}</span>
          <span class="community-body">
            <span class="community-label">${escapeHtml(l.label)}</span>
            ${l.desc ? `<span class="community-desc">${escapeHtml(l.desc)}</span>` : ""}
          </span>
          <span class="community-go" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M9 7h8v8"/></svg>
          </span>
        </a>`;
      })
      .join("");
  }

  function renderCertificates(main) {
    main.innerHTML = `<h1 class="dash-page-title">সার্টিফিকেট</h1><div id="certList"></div>`;
    const wrap = document.getElementById("certList");
    const { rows: allRows, known: rows, missing } = enrollmentRows();

    if (!rows.length) {
      // Don't tell an enrolled student they've never enrolled.
      wrap.innerHTML = allRows.length
        ? unavailableHTML(allRows.length)
        : `<div class="empty-state"><p>এখনো কোনো কোর্সে ভর্তি হননি।</p></div>`;
      return;
    }
    wrap.innerHTML = rows
      .map(
        (x) => `
      <div class="res-row">
        <div class="rleft">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="6"/><path d="m9 13-2 8 5-3 5 3-2-8"/></svg>
          <span>${escapeHtml(x.c.title_bn || x.c.title_en)} — ${x.p.pct}% সম্পন্ন</span>
        </div>
        ${x.p.total > 0 && x.p.done >= x.p.total
          ? `<button type="button" class="btn btn-primary btn-sm" data-view-cert="${x.c.id}">সার্টিফিকেট দেখুন</button>`
          : `<button class="btn btn-ghost btn-sm" disabled>লকড</button>`}
      </div>`
      )
      .join("") + (missing ? unavailableHTML(missing) : "");

    wrap.querySelectorAll("[data-view-cert]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const course = state.courses.find((c) => c.id === btn.dataset.viewCert);
        if (course) showCertificate(course);
      });
    });
  }

  /* A certificate number that is stable for a given student and course. Derived
     from the enrolment's own uuid rather than generated, so reopening or
     reprinting the certificate always shows the same number and it can be
     matched back to a real row if someone ever asks you to verify it. */
  function certificateId(enrollment, course) {
    const src = String((enrollment && enrollment.id) || course.id || "").replace(/[^a-fA-F0-9]/g, "");
    const block = (i) => (src.slice(i, i + 4) || "0000").toUpperCase().padStart(4, "0");
    return `SHD-${block(0)}-${block(4)}`;
  }

  function showCertificate(course) {
    const name = window.ShahedinAuth.displayName(state.user);
    const enrollment = state.enrollments.find((e) => e.course_id === course.id);
    /* The date the course was actually finished, not today. This used to be
       `new Date()`, so the same certificate showed a different date every time
       it was opened, which makes it worthless as a record. */
    const when = (enrollment && (enrollment.completed_at || enrollment.enrolled_at)) || null;
    const date = (when ? new Date(when) : new Date()).toLocaleDateString("bn-BD", { year: "numeric", month: "long", day: "numeric" });
    const title = course.title_bn || course.title_en;
    const certNo = certificateId(enrollment, course);

    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop cert-backdrop";
    backdrop.innerHTML = `
      <div class="modal modal-wide cert-modal">
        <button type="button" class="modal-close" id="certClose" aria-label="বন্ধ করুন">&times;</button>

        <div class="certificate" role="img"
             aria-label="${escapeHtml(name)}-এর নামে ${escapeHtml(title)} কোর্স সম্পন্নতার সার্টিফিকেট, ${escapeHtml(date)}">
          <div class="cert-frame">
            <span class="cert-corner tl" aria-hidden="true"></span>
            <span class="cert-corner tr" aria-hidden="true"></span>
            <span class="cert-corner bl" aria-hidden="true"></span>
            <span class="cert-corner br" aria-hidden="true"></span>

            <header class="cert-head">
              <span class="cert-monogram" aria-hidden="true">S</span>
              <span class="cert-wordmark">SHAHEDIN</span>
            </header>

            <p class="cert-label">সম্পন্নতার সার্টিফিকেট</p>
            <span class="cert-rule" aria-hidden="true"></span>

            <p class="cert-line">এই মর্মে প্রত্যয়ন করা হচ্ছে যে</p>
            <h2 class="cert-name">${escapeHtml(name)}</h2>
            <p class="cert-line">নিম্নলিখিত কোর্সটি সফলভাবে সম্পন্ন করেছেন</p>
            <h3 class="cert-course">${escapeHtml(title)}</h3>

            <div class="cert-foot">
              <div class="cert-sign">
                <span class="cert-sign-line" aria-hidden="true"></span>
                <b>শাহেদীন</b>
                <small>ইন্সট্রাক্টর</small>
              </div>

              <div class="cert-seal" aria-hidden="true">
                <span class="cert-seal-ring"></span>
                <span class="cert-seal-mark">S</span>
                <span class="cert-seal-text">সম্পন্ন</span>
              </div>

              <div class="cert-sign">
                <span class="cert-sign-line" aria-hidden="true"></span>
                <b>${escapeHtml(date)}</b>
                <small>সম্পন্নের তারিখ</small>
              </div>
            </div>

            <p class="cert-id">সার্টিফিকেট নং <span>${escapeHtml(certNo)}</span></p>
          </div>
        </div>

        <div class="dash-modal-actions">
          <button type="button" class="btn btn-primary btn-block" id="certPrint">প্রিন্ট / PDF সেভ করুন</button>
        </div>
      </div>`;

    document.body.appendChild(backdrop);
    const close = () => { backdrop.remove(); document.removeEventListener("keydown", onKey); };
    function onKey(e) { if (e.key === "Escape") close(); }
    document.addEventListener("keydown", onKey);
    backdrop.querySelector("#certClose").addEventListener("click", close);
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
    backdrop.querySelector("#certPrint").addEventListener("click", () => window.print());
  }

  function renderOrders(main) {
    main.innerHTML = `<h1 class="dash-page-title">অর্ডার</h1><div id="orderList"></div>`;
    const wrap = document.getElementById("orderList");
    if (!state.orders.length) {
      wrap.innerHTML = `<div class="empty-state"><p>এখনো কোনো অর্ডার নেই। <a class="text-link" href="store.html">স্টোর দেখুন →</a></p></div>`;
      return;
    }
    /* The buyer lands on this tab straight after paying, so whatever they just
       bought has to be reachable from here. Digital products get their real
       download; anything else says honestly what is happening instead of
       showing a dead button. */
    function actionCell(o) {
      if (o.kind === "course") return `<a class="text-link" href="#courses">দেখুন</a>`;
      const p = productFor(o);
      if (p && p.delivery_url && o.status === "completed") {
        const label = p.delivery_label || (p.delivery_type === "link" ? "খুলুন" : "ডাউনলোড");
        return `<a href="${escapeHtml(p.delivery_url)}" target="_blank" rel="noopener"${p.delivery_type === "file" ? " download" : ""} class="btn btn-primary btn-sm">${escapeHtml(label)}</a>`;
      }
      if (p && p.type === "physical") return `<span class="small-note">ডেলিভারিতে</span>`;
      return `<span class="small-note">শীঘ্রই পাঠানো হবে</span>`;
    }

    wrap.innerHTML = `
      <table class="admin-table">
        <thead><tr><th>আইটেম</th><th>ধরন</th><th>পরিমাণ</th><th>মূল্য</th><th>তারিখ</th><th>অবস্থা</th><th></th></tr></thead>
        <tbody>
          ${state.orders
            .map(
              (o) => `
            <!-- data-label drives the mobile card layout in css/style.css:
                 below 760px each row becomes a card and every cell shows its
                 column name, so the table never scrolls sideways. -->
            <tr>
              <td data-label="আইটেম">${escapeHtml(o.item_title)}</td>
              <td data-label="ধরন">${o.kind === "course" ? "কোর্স" : "প্রোডাক্ট"}</td>
              <td data-label="পরিমাণ">${o.qty}</td>
              <td data-label="মূল্য">${o.amount_bdt === 0 ? "ফ্রি" : "৳" + o.amount_bdt}</td>
              <td data-label="তারিখ">${new Date(o.created_at).toLocaleDateString("bn-BD")}</td>
              <td data-label="অবস্থা"><span class="badge badge-live">${o.status === "completed" ? "সম্পন্ন" : o.status === "pending" ? "অপেক্ষমাণ" : "বাতিল"}</span></td>
              <td data-label="">${actionCell(o)}</td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>`;
  }

  /* Two stores behind one form, deliberately:
       - the display name lives in auth.users metadata and is mirrored into
         `profiles` by a trigger, so it is saved through ShahedinAuth.
       - everything below is written straight to `profiles`, where a student
         holds a column-level grant on exactly these six fields and nothing
         else (see section 20 of schema.sql).
     The phone stays read-only: it is the login credential, and changing it
     means re-verifying by OTP, which is a different flow entirely. */
  const PROFILE_FIELDS = [
    { key: "email", group: "contact", label: "ইমেইল", type: "email", help: "অর্ডার কনফার্মেশন ও রসিদ এখানে পাঠানো হবে।", placeholder: "you@example.com" },
    { key: "city", group: "contact", label: "শহর / জেলা", type: "text", placeholder: "ঢাকা" },
    { key: "address", group: "contact", label: "ঠিকানা", type: "textarea", wide: true, help: "ফিজিক্যাল অর্ডার পৌঁছে দিতে কাজে লাগে।", placeholder: "বাসা ও রোড নম্বর, এলাকা, থানা, জেলা" },
    { key: "institution", group: "about", label: "শিক্ষা প্রতিষ্ঠান", type: "text", placeholder: "ঢাকা বিশ্ববিদ্যালয়" },
    { key: "profession", group: "about", label: "পেশা", type: "text", placeholder: "শিক্ষার্থী" },
    { key: "bio", group: "about", label: "নিজের সম্পর্কে", type: "textarea", wide: true, placeholder: "কী শিখতে চান, কী নিয়ে কাজ করেন…" },
  ];

  /* One "আপনার তথ্য" box holding six unrelated fields told the student nothing
     about why any of them were being asked for. Split into groups that each
     answer that question in their own subtitle. */
  const PROFILE_GROUPS = [
    { id: "contact", title: "যোগাযোগ", desc: "অর্ডার, রসিদ ও ডেলিভারির জন্য আমরা এগুলো ব্যবহার করি।" },
    { id: "about", title: "আপনার সম্পর্কে", desc: "ঐচ্ছিক। কারা শিখছেন তা জানলে আমরা আরও ভালো কোর্স বানাতে পারি।" },
  ];

  function renderSettings(main) {
    const p = state.profile || {};
    const name = window.ShahedinAuth.displayName(state.user);
    const phone = window.ShahedinAuth.formatPhone(state.user.phone);

    // Completeness is a reason to fill optional fields in. Counted over the
    // display name plus the six profile fields.
    const filled = (name ? 1 : 0) + PROFILE_FIELDS.filter((f) => String(p[f.key] || "").trim()).length;
    const pct = Math.round((filled / (PROFILE_FIELDS.length + 1)) * 100);
    const joined = p.created_at ? new Date(p.created_at).toLocaleDateString("bn-BD", { year: "numeric", month: "long" }) : "";

    const fieldHTML = (f) => {
      const value = escapeHtml(p[f.key] || "");
      const control = f.type === "textarea"
        ? `<textarea id="set_${f.key}" name="${f.key}" rows="3" placeholder="${escapeHtml(f.placeholder)}">${value}</textarea>`
        : `<input type="${f.type}" id="set_${f.key}" name="${f.key}" value="${value}" placeholder="${escapeHtml(f.placeholder)}">`;
      return `
        <div class="field${f.wide ? " field-wide" : ""}">
          <label for="set_${f.key}">${f.label}</label>
          ${control}
          ${f.help ? `<p class="field-help">${f.help}</p>` : ""}
        </div>`;
    };

    main.innerHTML = `
      <h1 class="dash-page-title">সেটিংস</h1>

      <!-- Identity card. A settings page with no sense of WHO the account
           belongs to is just a form; this makes it an account. -->
      <div class="profile-card">
        <span class="profile-avatar" aria-hidden="true">${escapeHtml((name || "?").trim().charAt(0))}</span>
        <div class="profile-id">
          <h2>${escapeHtml(name || "নাম দেওয়া হয়নি")}</h2>
          <p>${escapeHtml([phone, p.email].filter(Boolean).join(" · ") || "যোগাযোগের তথ্য যোগ করুন")}</p>
          ${joined ? `<p class="profile-joined">যুক্ত হয়েছেন ${escapeHtml(joined)}</p>` : ""}
        </div>
        <div class="profile-meter">
          <div class="profile-meter-head">
            <span>প্রোফাইল সম্পূর্ণ</span>
            <b>${bn(pct)}%</b>
          </div>
          <div class="progress-track"><div class="progress-fill" style="width:${pct}%;"></div></div>
          ${pct < 100 ? `<p>${bn(PROFILE_FIELDS.length + 1 - filled)}টি ঘর এখনো বাকি</p>` : `<p>সব তথ্য দেওয়া হয়েছে</p>`}
        </div>
      </div>

      <form id="settingsForm" class="dash-settings-form">

        <section class="settings-row">
          <div class="settings-row-label">
            <h2>অ্যাকাউন্ট</h2>
            <p>আপনার পরিচয় ও লগইন তথ্য।</p>
          </div>
          <div class="settings-row-fields">
            <div class="field">
              <label for="set_name">প্রদর্শিত নাম</label>
              <input type="text" id="set_name" name="name" value="${escapeHtml(name)}">
            </div>
            <div class="field">
              <label for="set_phone">ফোন নম্বর</label>
              <div class="field-locked">
                <input type="tel" id="set_phone" value="${escapeHtml(phone)}" readonly tabindex="-1">
                <span class="field-lock" title="পরিবর্তন করা যায় না" aria-hidden="true">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
                </span>
              </div>
              <p class="field-help">এই নম্বর দিয়েই আপনি লগ ইন করেন।</p>
            </div>
          </div>
        </section>

        ${PROFILE_GROUPS.map((g) => `
          <section class="settings-row">
            <div class="settings-row-label">
              <h2>${g.title}</h2>
              <p>${g.desc}</p>
            </div>
            <div class="settings-row-fields">
              ${PROFILE_FIELDS.filter((f) => f.group === g.id).map(fieldHTML).join("")}
            </div>
          </section>`).join("")}

        <p class="settings-privacy">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 4 6v6c0 4.5 3.2 8.3 8 9 4.8-.7 8-4.5 8-9V6z"/></svg>
          <span>এই তথ্য শুধু Shahedin টিম দেখতে পায়। কীভাবে ব্যবহার করা হয় তা <a href="privacy.html">প্রাইভেসি পলিসিতে</a> লেখা আছে।</span>
        </p>

        <!-- Appears only once something has actually changed, so the page is
             calm at rest and it is never ambiguous whether there is anything
             left to save. -->
        <div class="settings-bar" id="settingsBar" hidden>
          <p class="form-status" id="settingsStatus" role="status"></p>
          <div class="settings-bar-actions">
            <button type="button" class="btn btn-ghost btn-sm" id="settingsReset">বাতিল করুন</button>
            <button type="submit" class="btn btn-primary btn-sm">পরিবর্তন সংরক্ষণ করুন</button>
          </div>
        </div>
      </form>`;

    /* Dirty tracking. The save bar is hidden until something actually differs
       from what was loaded, so "is there anything unsaved?" is answered by
       looking at the page rather than by remembering. */
    const settingsForm = document.getElementById("settingsForm");
    const bar = document.getElementById("settingsBar");
    const editable = ["name"].concat(PROFILE_FIELDS.map((f) => f.key));
    const initial = {};
    editable.forEach((k) => { initial[k] = settingsForm[k].value; });

    const isDirty = () => editable.some((k) => settingsForm[k].value !== initial[k]);
    const syncBar = () => { bar.hidden = !isDirty(); };
    editable.forEach((k) => {
      settingsForm[k].addEventListener("input", syncBar);
    });

    // Shared by the reset and submit handlers, so it lives outside both.
    const statusEl = document.getElementById("settingsStatus");
    const setStatus = (text, kind) => {
      statusEl.textContent = text || "";
      statusEl.classList.toggle("is-error", kind === "error");
      statusEl.classList.toggle("is-ok", kind === "ok");
    };

    document.getElementById("settingsReset").addEventListener("click", () => {
      editable.forEach((k) => { settingsForm[k].value = initial[k]; });
      // Cleared, not hidden: the bar's default "you have unsaved changes"
      // line is a :empty::before rule, so hiding the node would suppress it
      // the next time the student edits something.
      setStatus("");
      syncBar();
    });

    settingsForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.target;

      // Checked before saving: a mistyped address is worse than a blank one,
      // because it looks like a working contact route and silently is not.
      const email = form.email.value.trim();
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
        setStatus("ইমেইল ঠিকানাটি সঠিক নয়। উদাহরণ: you@example.com", "error");
        form.email.focus();
        return;
      }

      const btn = form.querySelector('button[type="submit"]');
      const original = btn.textContent;
      btn.disabled = true;
      btn.textContent = "সংরক্ষণ হচ্ছে…";
      setStatus("");

      try {
        await window.ShahedinAuth.updateProfile({ full_name: form.name.value.trim() });

        const patch = {};
        PROFILE_FIELDS.forEach((f) => { patch[f.key] = form[f.key].value.trim() || null; });
        const c = window.ShahedinAuth.client();
        const { error } = await c.from("profiles").update(patch).eq("id", state.user.id);
        if (error) throw error;

        state.profile = Object.assign({}, state.profile || {}, patch);
        // The saved values become the new baseline, so the bar retreats and
        // the identity card and completeness meter pick the changes up.
        editable.forEach((k) => { initial[k] = form[k].value; });
        renderTab("settings");
        window.showToast && window.showToast("সেটিংস সংরক্ষণ করা হয়েছে।");
        return;
      } catch (err) {
        setStatus("সংরক্ষণ করা যায়নি, আবার চেষ্টা করুন।", "error");
        // A database still on the old schema has no email/city columns.
        console.warn(
          "Shahedin dashboard: couldn't save profile. If this says a column does not exist, " +
          "run section 20 of schema.sql in the Supabase SQL editor.",
          err
        );
      } finally {
        btn.disabled = false;
        btn.textContent = original;
      }
    });
  }

  function handlePurchaseToast() {
    const kind = sessionStorage.getItem("shahedin_purchase_success");
    if (!kind) return;
    sessionStorage.removeItem("shahedin_purchase_success");
    window.showToast && window.showToast(kind === "course" ? "ভর্তি সম্পন্ন হয়েছে! এখন কোর্স শুরু করতে পারেন।" : "অর্ডার সম্পন্ন হয়েছে!");
  }

  init();
})();
