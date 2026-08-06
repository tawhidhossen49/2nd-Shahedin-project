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

  const [profilesRes, enrollmentsRes, ordersRes] = await Promise.all([
    c.from("profiles").select("*").order("created_at", { ascending: false }),
    c.from("enrollments").select("user_id, course_id, completed, enrolled_at, courses(title_en, title_bn)"),
    c.from("orders").select("user_id, item_title, kind, amount_bdt, status, created_at").order("created_at", { ascending: false }),
  ]);

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

        <h3 style="font-size:.95rem; margin-bottom:10px;">Enrolled courses (${s.enrollments.length})</h3>
        ${
          s.enrollments.length
            ? `<table class="admin-table" style="margin-bottom:24px;">
          <thead><tr><th>Course</th><th>Enrolled</th><th>Status</th></tr></thead>
          <tbody>
            ${s.enrollments
              .map(
                (e) => `<tr>
                <td>${Admin.escapeHtml((e.courses && (e.courses.title_bn || e.courses.title_en)) || "(deleted course)")}</td>
                <td class="row-sub">${new Date(e.enrolled_at).toLocaleDateString()}</td>
                <td>${e.completed ? '<span class="badge badge-live">Completed</span>' : '<span class="badge badge-draft">In progress</span>'}</td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>`
            : `<p class="row-sub" style="margin-bottom:24px;">Not enrolled in anything yet.</p>`
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
  }

  renderShellOnce();
})();
