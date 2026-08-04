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
    { id: "certificates", label: "সার্টিফিকেট", icon: "M12 8a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM9 13l-2 8 5-3 5 3-2-8" },
    { id: "orders", label: "অর্ডার", icon: "M9 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM19 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6" },
    { id: "settings", label: "সেটিংস", icon: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" },
  ];

  function escapeHtml(str) {
    return (str == null ? "" : String(str)).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  }

  const app = document.getElementById("dashApp");
  if (!app) return;

  let state = { user: null, enrollments: [], courses: [], orders: [] };

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
    const [enrollRes, orderRes] = await Promise.all([
      c.from("enrollments").select("*").eq("user_id", state.user.id).order("enrolled_at", { ascending: false }),
      c.from("orders").select("*").eq("user_id", state.user.id).order("created_at", { ascending: false }),
    ]);
    state.enrollments = enrollRes.data || [];
    state.orders = orderRes.data || [];

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
  }

  function courseFor(enrollment) {
    return state.courses.find((c) => c.id === enrollment.course_id);
  }

  function progressFor(enrollment) {
    const course = courseFor(enrollment);
    const total = course && Array.isArray(course.content_blocks) ? course.content_blocks.length : 0;
    const done = Array.isArray(enrollment.completed_blocks) ? enrollment.completed_blocks.length : 0;
    const pct = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
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
          <h3>${escapeHtml(course.title_en || course.title_bn)}</h3>
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

  function renderResources(main) {
    main.innerHTML = `<h1 class="dash-page-title">রিসোর্স</h1><div id="resList"></div>`;
    const wrap = document.getElementById("resList");
    const items = [];
    state.enrollments.forEach((e) => {
      const course = courseFor(e);
      if (!course || !Array.isArray(course.content_blocks)) return;
      course.content_blocks.forEach((b) => {
        if (b.type === "resource" || b.type === "pdf") {
          items.push({ block: b, courseTitle: course.title_en || course.title_bn, url: b.type === "pdf" ? b.pdf_url : b.url });
        }
      });
    });

    if (!items.length) {
      wrap.innerHTML = `<div class="empty-state"><p>আপনার ভর্তি হওয়া কোর্সে এখনো কোনো রিসোর্স বা PDF যোগ করা হয়নি।</p></div>`;
      return;
    }
    wrap.innerHTML = items
      .map(
        (it) => `
      <div class="res-row">
        <div class="rleft">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
          <span>${escapeHtml(it.block.title)} <span class="small-note">— ${escapeHtml(it.courseTitle)}</span></span>
        </div>
        ${it.url ? `<a href="${escapeHtml(it.url)}" target="_blank" rel="noopener" class="btn btn-ghost btn-sm">দেখুন</a>` : `<span class="small-note">লিংক নেই</span>`}
      </div>`
      )
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
          <span>${escapeHtml(x.c.title_en || x.c.title_bn)} — ${x.p.pct}% সম্পন্ন</span>
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

  function showCertificate(course) {
    const name = window.ShahedinAuth.displayName(state.user);
    const date = new Date().toLocaleDateString("bn-BD", { year: "numeric", month: "long", day: "numeric" });
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = `
      <div class="modal modal-wide">
        <button type="button" class="modal-close" id="certClose">&times;</button>
        <div class="certificate">
          <div class="cert-brand"><span class="dot"></span>Shahedin</div>
          <p class="cert-label">সম্পন্নতার সার্টিফিকেট</p>
          <p class="cert-line">এই মর্মে প্রত্যয়ন করা হচ্ছে যে</p>
          <h2 class="cert-name">${escapeHtml(name)}</h2>
          <p class="cert-line">সফলভাবে সম্পন্ন করেছেন</p>
          <h3 class="cert-course">${escapeHtml(course.title_en || course.title_bn)}</h3>
          <p class="cert-date">${date}</p>
        </div>
        <div class="dash-modal-actions">
          <button type="button" class="btn btn-primary btn-block" id="certPrint">প্রিন্ট / সেভ করুন</button>
        </div>
      </div>`;
    document.body.appendChild(backdrop);
    backdrop.querySelector("#certClose").addEventListener("click", () => backdrop.remove());
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) backdrop.remove(); });
    backdrop.querySelector("#certPrint").addEventListener("click", () => window.print());
  }

  function renderOrders(main) {
    main.innerHTML = `<h1 class="dash-page-title">অর্ডার</h1><div id="orderList"></div>`;
    const wrap = document.getElementById("orderList");
    if (!state.orders.length) {
      wrap.innerHTML = `<div class="empty-state"><p>এখনো কোনো অর্ডার নেই। <a class="text-link" href="store.html">স্টোর দেখুন →</a></p></div>`;
      return;
    }
    wrap.innerHTML = `
      <table class="admin-table">
        <thead><tr><th>আইটেম</th><th>ধরন</th><th>পরিমাণ</th><th>মূল্য</th><th>তারিখ</th><th>অবস্থা</th></tr></thead>
        <tbody>
          ${state.orders
            .map(
              (o) => `
            <tr>
              <td>${escapeHtml(o.item_title)}</td>
              <td>${o.kind === "course" ? "কোর্স" : "প্রোডাক্ট"}</td>
              <td>${o.qty}</td>
              <td>${o.amount_bdt === 0 ? "ফ্রি" : "৳" + o.amount_bdt}</td>
              <td>${new Date(o.created_at).toLocaleDateString("bn-BD")}</td>
              <td><span class="badge badge-live">${o.status === "completed" ? "সম্পন্ন" : o.status === "pending" ? "অপেক্ষমাণ" : "বাতিল"}</span></td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>`;
  }

  function renderSettings(main) {
    main.innerHTML = `
      <h1 class="dash-page-title">সেটিংস</h1>
      <form id="settingsForm" class="dash-settings-form">
        <div class="field"><label>প্রদর্শিত নাম</label><input type="text" name="name" value="${escapeHtml(window.ShahedinAuth.displayName(state.user))}"></div>
        <div class="field"><label>ফোন নম্বর</label><input type="tel" value="${escapeHtml(window.ShahedinAuth.formatPhone(state.user.phone))}" disabled></div>
        <button type="submit" class="btn btn-primary">পরিবর্তন সংরক্ষণ করুন</button>
      </form>`;

    document.getElementById("settingsForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.target;
      const btn = form.querySelector('button[type="submit"]');
      const original = btn.textContent;
      btn.disabled = true;
      btn.textContent = "সংরক্ষণ হচ্ছে…";
      try {
        await window.ShahedinAuth.updateProfile({ full_name: form.name.value.trim() });
        window.showToast && window.showToast("সেটিংস সংরক্ষণ করা হয়েছে।");
      } catch (err) {
        window.showToast && window.showToast("সংরক্ষণ করা যায়নি, আবার চেষ্টা করুন।");
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
