(async function () {
  "use strict";
  const admin = await Admin.requireAdmin();
  if (!admin) return;

  Admin.renderShell(
    "students.html",
    "Students",
    "Everyone who has signed up on the site, with what they've enrolled in and bought.",
    admin
  );
  const content = document.getElementById("adminContent");
  content.innerHTML = `<div class="loading-row"><div class="spinner"></div> Loading students…</div>`;

  const c = Admin.client();
  let students = [];
  let searchTerm = "";

  const [profilesRes, enrollmentsRes, ordersRes, coursesRes] = await Promise.all([
    c.from("profiles").select("*").order("created_at", { ascending: false }),
    // The enrolment row's own id is needed so access can be revoked.
    c.from("enrollments").select("id, user_id, course_id, completed, enrolled_at, courses(title_en, title_bn)"),
    c.from("orders").select("user_id, item_title, kind, amount_bdt, status, created_at").order("created_at", { ascending: false }),
    // Every course, published or not, so access can be granted to something
    // that is not on sale yet.
    c.from("courses").select("id, title_bn, title_en, is_free, price_bdt").order("sort_order", { ascending: true }),
  ]);

  const allCourses = (coursesRes && coursesRes.data) || [];
  const courseName = (course) => (course && (course.title_bn || course.title_en)) || "(মুছে ফেলা কোর্স)";

  if (profilesRes.error) {
    content.innerHTML = `<div class="notice">Couldn't load students: ${Admin.escapeHtml(profilesRes.error.message)}<br><br>
      Make sure you've run the latest <code>schema.sql</code> in the Supabase SQL editor — it adds the <code>profiles</code> table.</div>`;
    return;
  }

  const enrollmentsByUser = {};
  (enrollmentsRes.data || []).forEach((e) => {
    (enrollmentsByUser[e.user_id] = enrollmentsByUser[e.user_id] || []).push(e);
  });
  const ordersByUser = {};
  (ordersRes.data || []).forEach((o) => {
    (ordersByUser[o.user_id] = ordersByUser[o.user_id] || []).push(o);
  });

  students = (profilesRes.data || []).map((p) => {
    const myEnrollments = enrollmentsByUser[p.id] || [];
    const myOrders = ordersByUser[p.id] || [];
    const totalSpent = myOrders.filter((o) => o.status === "completed").reduce((sum, o) => sum + (o.amount_bdt || 0), 0);
    return Object.assign({}, p, { enrollments: myEnrollments, orders: myOrders, totalSpent });
  });

  function formatPhone(e164) {
    if (!e164) return "—";
    return e164.startsWith("+880") ? "0" + e164.slice(4) : e164;
  }

  function renderShellOnce() {
    content.innerHTML = `
      <div class="stat-grid">
        <div class="stat-card"><div class="label">Total students</div><div class="value">${students.length}</div></div>
        <div class="stat-card"><div class="label">Total enrollments</div><div class="value">${students.reduce((n, s) => n + s.enrollments.length, 0)}</div></div>
        <div class="stat-card"><div class="label">Total revenue</div><div class="value">৳${students.reduce((n, s) => n + s.totalSpent, 0).toLocaleString()}</div></div>
      </div>

      <div class="form-field" style="max-width:320px; margin-bottom:16px;">
        <input type="text" id="studentSearch" placeholder="Search name, phone, email, city…">
      </div>

      <div id="studentTableWrap"></div>`;

    document.getElementById("studentSearch").addEventListener("input", (e) => {
      searchTerm = e.target.value;
      renderTable();
    });

    renderTable();
  }

  function renderTable() {
    const wrap = document.getElementById("studentTableWrap");
    const term = searchTerm.trim().toLowerCase();
    const filtered = !term
      ? students
      // Search now covers the details students fill in themselves, so you can
      // find everyone in Chattogram or look someone up by their email.
      : students.filter((s) =>
          [s.full_name, s.phone, s.email, s.city, s.institution, s.profession]
            .filter(Boolean).join(" ").toLowerCase().includes(term)
        );

    wrap.innerHTML = !filtered.length
      ? `<div class="empty-state">${students.length ? "No students match your search." : "No students have signed up yet."}</div>`
      : `<table class="admin-table">
          <thead><tr><th>Name</th><th>Contact</th><th>Location</th><th>Joined</th><th>Courses</th><th>Total spent</th><th></th></tr></thead>
          <tbody>
            ${filtered
              .map(
                (s) => `
              <tr data-id="${s.id}">
                <td>
                  <div class="row-title">${Admin.escapeHtml(s.full_name || "(no name)")}</div>
                  ${s.institution || s.profession
                    ? `<div class="row-sub">${Admin.escapeHtml([s.profession, s.institution].filter(Boolean).join(" · "))}</div>`
                    : ""}
                </td>
                <td>
                  <div>${Admin.escapeHtml(formatPhone(s.phone))}</div>
                  ${s.email ? `<div class="row-sub"><a href="mailto:${Admin.escapeHtml(s.email)}">${Admin.escapeHtml(s.email)}</a></div>` : `<div class="row-sub">no email given</div>`}
                </td>
                <td class="row-sub">${Admin.escapeHtml(s.city || "—")}</td>
                <td class="row-sub">${new Date(s.created_at).toLocaleDateString()}</td>
                <td>${s.enrollments.length}</td>
                <td>৳${s.totalSpent.toLocaleString()}</td>
                <td class="row-actions"><button type="button" class="btn btn-ghost btn-sm" data-view="${s.id}">View</button></td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>`;

    wrap.querySelectorAll("[data-view]").forEach((btn) => {
      btn.addEventListener("click", () => openDetail(btn.dataset.view));
    });
  }

  /* Everything the student filled in on their own Settings page. Only the
     fields they actually answered are shown: a wall of "—" rows tells you
     nothing and buries the ones that do have an answer. */
  function profileBlock(s) {
    const rows = [
      ["Email", s.email ? `<a href="mailto:${Admin.escapeHtml(s.email)}">${Admin.escapeHtml(s.email)}</a>` : ""],
      ["City / district", Admin.escapeHtml(s.city || "")],
      ["Institution", Admin.escapeHtml(s.institution || "")],
      ["Profession", Admin.escapeHtml(s.profession || "")],
      ["Address", s.address ? `<span style="white-space:pre-wrap;">${Admin.escapeHtml(s.address)}</span>` : ""],
      ["About", s.bio ? `<span style="white-space:pre-wrap;">${Admin.escapeHtml(s.bio)}</span>` : ""],
    ].filter(([, v]) => v);

    if (!rows.length) {
      return `<p class="row-sub" style="margin-bottom:24px;">This student hasn't filled in any profile details yet.</p>`;
    }
    return `
      <h3 style="font-size:.95rem; margin-bottom:10px;">Profile details</h3>
      <table class="admin-table" style="margin-bottom:24px;">
        <tbody>
          ${rows.map(([label, value]) => `<tr><td class="row-sub" style="width:150px;">${label}</td><td>${value}</td></tr>`).join("")}
        </tbody>
      </table>`;
  }

  function openDetail(id) {
    const s = students.find((x) => x.id === id);
    if (!s) return;

    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.id = "studentModal";
    backdrop.innerHTML = `
      <div class="modal" style="max-width:600px;">
        <div class="modal-head">
          <h2>${Admin.escapeHtml(s.full_name || "(no name)")}</h2>
          <button class="modal-close" id="closeStudentModal">&times;</button>
        </div>
        <p class="row-sub" style="margin-bottom:20px;">${Admin.escapeHtml(formatPhone(s.phone))} · joined ${new Date(s.created_at).toLocaleDateString()}</p>

        ${profileBlock(s)}

        <h3 style="font-size:.95rem; margin-bottom:10px;">কোর্স অ্যাক্সেস (${s.enrollments.length})</h3>

        <!-- Manual grant. There is no payment gateway: the student pays by
             bKash send-money after filling in the course's enrolment form, and
             access is handed over here once the payment has been verified. -->
        <div class="panel" style="padding:16px; margin-bottom:16px;">
          <div class="form-field" style="margin-bottom:10px;">
            <label for="grantCourse">নতুন কোর্সে অ্যাক্সেস দিন
              <span class="hint">পেমেন্ট যাচাই করার পরেই দিন</span>
            </label>
            <select id="grantCourse">
              <option value="">— কোর্স বেছে নিন —</option>
              ${allCourses
                .map((course) => {
                  const already = s.enrollments.some((e) => e.course_id === course.id);
                  return `<option value="${Admin.escapeHtml(course.id)}"${already ? " disabled" : ""}>${Admin.escapeHtml(courseName(course))}${already ? " — আগেই দেওয়া আছে" : ""}</option>`;
                })
                .join("")}
            </select>
          </div>
          <button type="button" class="btn btn-primary btn-sm" id="grantBtn">অ্যাক্সেস দিন</button>
          <p class="field-error" id="grantStatus" hidden></p>
        </div>

        ${
          s.enrollments.length
            ? `<table class="admin-table" style="margin-bottom:24px;">
          <thead><tr><th>কোর্স</th><th>যেদিন থেকে</th><th>অবস্থা</th><th></th></tr></thead>
          <tbody>
            ${s.enrollments
              .map(
                (e) => `<tr>
                <td>${Admin.escapeHtml(courseName(e.courses))}</td>
                <td class="row-sub">${new Date(e.enrolled_at).toLocaleDateString()}</td>
                <td>${e.completed ? '<span class="badge badge-live">সম্পন্ন</span>' : '<span class="badge badge-draft">চলমান</span>'}</td>
                <td><div class="row-actions"><button type="button" class="btn btn-danger btn-sm" data-revoke="${Admin.escapeHtml(e.id)}" data-course="${Admin.escapeHtml(courseName(e.courses))}">সরিয়ে দিন</button></div></td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>`
            : `<p class="row-sub" style="margin-bottom:24px;">এখনো কোনো কোর্সে অ্যাক্সেস দেওয়া হয়নি।</p>`
        }

        <h3 style="font-size:.95rem; margin-bottom:10px;">Orders (${s.orders.length})</h3>
        ${
          s.orders.length
            ? `<table class="admin-table">
          <thead><tr><th>Item</th><th>Amount</th><th>Date</th><th>Status</th></tr></thead>
          <tbody>
            ${s.orders
              .map(
                (o) => `<tr>
                <td>${Admin.escapeHtml(o.item_title)}</td>
                <td>${o.amount_bdt === 0 ? "Free" : "৳" + o.amount_bdt.toLocaleString()}</td>
                <td class="row-sub">${new Date(o.created_at).toLocaleDateString()}</td>
                <td>${o.status === "completed" ? '<span class="badge badge-live">Completed</span>' : Admin.escapeHtml(o.status)}</td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>`
            : `<p class="row-sub">No orders yet.</p>`
        }
      </div>`;
    document.body.appendChild(backdrop);
    document.getElementById("closeStudentModal").addEventListener("click", () => backdrop.remove());
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) backdrop.remove(); });

    const status = backdrop.querySelector("#grantStatus");
    const setStatus = (text, ok) => {
      status.textContent = text || "";
      status.hidden = !text;
      status.style.color = ok ? "var(--good)" : "";
    };

    /* Reloads the page's data and reopens this student, so the enrolment list
       and the disabled options in the picker both reflect what just changed
       without a manual refresh. */
    async function refresh(studentId) {
      const { data } = await c
        .from("enrollments")
        .select("id, user_id, course_id, completed, enrolled_at, courses(title_en, title_bn)");
      const byUser = {};
      (data || []).forEach((e) => { (byUser[e.user_id] = byUser[e.user_id] || []).push(e); });
      students.forEach((st) => { st.enrollments = byUser[st.id] || []; });
      backdrop.remove();
      renderTable();
      openDetail(studentId);
    }

    backdrop.querySelector("#grantBtn").addEventListener("click", async (ev) => {
      const select = backdrop.querySelector("#grantCourse");
      const courseId = select.value;
      if (!courseId) { setStatus("প্রথমে একটি কোর্স বেছে নিন।", false); return; }

      const btn = ev.currentTarget;
      const original = btn.textContent;
      btn.disabled = true;
      btn.textContent = "দেওয়া হচ্ছে…";
      setStatus("");

      // students_count is kept current by a trigger on enrollments, so it is
      // deliberately not written here.
      const { error } = await c.from("enrollments").insert({ user_id: s.id, course_id: courseId });

      btn.disabled = false;
      btn.textContent = original;

      if (error) {
        // 23505 is the unique (user_id, course_id) constraint: not a fault,
        // just someone clicking twice or two admins working at once.
        if (error.code === "23505") {
          setStatus("এই শিক্ষার্থী আগে থেকেই এই কোর্সে ভর্তি আছেন।", false);
          return;
        }
        // 42501 is an RLS refusal. Surfaced rather than swallowed, because the
        // most likely cause is section 22 of schema.sql not having been run.
        setStatus(
          error.code === "42501"
            ? "ডেটাবেস অনুমতি দেয়নি। schema.sql-এর ২২ নম্বর অংশ চালানো হয়েছে কি না দেখুন।"
            : "অ্যাক্সেস দেওয়া যায়নি: " + error.message,
          false
        );
        return;
      }

      Admin.toast("অ্যাক্সেস দেওয়া হয়েছে।");
      await refresh(s.id);
    });

    backdrop.querySelectorAll("[data-revoke]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm(`"${btn.dataset.course}" কোর্সের অ্যাক্সেস সরিয়ে দেবেন?\n\nশিক্ষার্থী আর কোর্সটি দেখতে পারবেন না। অগ্রগতির তথ্যও মুছে যাবে।`)) return;
        btn.disabled = true;
        const { error } = await c.from("enrollments").delete().eq("id", btn.dataset.revoke);
        if (error) {
          btn.disabled = false;
          setStatus(
            error.code === "42501"
              ? "ডেটাবেস অনুমতি দেয়নি। schema.sql-এর ২২ নম্বর অংশ চালানো হয়েছে কি না দেখুন।"
              : "সরানো যায়নি: " + error.message,
            false
          );
          return;
        }
        Admin.toast("অ্যাক্সেস সরিয়ে দেওয়া হয়েছে।");
        await refresh(s.id);
      });
    });
  }

  renderShellOnce();
})();
