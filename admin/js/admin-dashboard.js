(async function () {
  "use strict";
  const admin = await Admin.requireAdmin();
  if (!admin) return;

  Admin.renderShell("index.html", "Dashboard", `Welcome back, ${Admin.escapeHtml((admin.full_name || admin.email).split("@")[0])}.`, admin);
  const content = document.getElementById("adminContent");
  content.innerHTML = `<div class="loading-row"><div class="spinner"></div> Loading overview…</div>`;

  const c = Admin.client();

  const [coursesRes, productsRes, viewsRes, viewsAllRes, logRes] = await Promise.all([
    c.from("courses").select("id,is_published", { count: "exact" }),
    c.from("products").select("id,is_published", { count: "exact" }),
    c.from("page_views").select("id").gte("viewed_at", new Date(Date.now() - 30 * 86400000).toISOString()),
    c.from("page_views").select("id"),
    c.from("activity_log").select("*").order("created_at", { ascending: false }).limit(8),
  ]);

  const courses = coursesRes.data || [];
  const products = productsRes.data || [];
  const publishedCourses = courses.filter((x) => x.is_published).length;
  const publishedProducts = products.filter((x) => x.is_published).length;
  const views30d = (viewsRes.data || []).length;
  const viewsAll = (viewsAllRes.data || []).length;
  const activity = logRes.data || [];

  content.innerHTML = `
    <div class="stat-grid">
      <div class="stat-card">
        <div class="label">Courses</div>
        <div class="value">${courses.length}</div>
        <div class="sub">${publishedCourses} live · ${courses.length - publishedCourses} draft</div>
      </div>
      <div class="stat-card">
        <div class="label">Store products</div>
        <div class="value">${products.length}</div>
        <div class="sub">${publishedProducts} live · ${products.length - publishedProducts} draft</div>
      </div>
      <div class="stat-card">
        <div class="label">Page views (30d)</div>
        <div class="value">${views30d}</div>
        <div class="sub">${viewsAll} all-time</div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head">
        <div>
          <h2>Quick actions</h2>
          <p>The most common things you'll do here.</p>
        </div>
      </div>
      <div style="display:flex; gap:12px; flex-wrap:wrap;">
        <a href="courses.html?new=1" class="btn btn-primary">+ Add a course</a>
        <a href="products.html?new=1" class="btn btn-primary">+ Add a product</a>
        <a href="analytics.html" class="btn btn-ghost">View analytics</a>
        <a href="settings.html" class="btn btn-ghost">Edit contact info</a>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head">
        <div>
          <h2>Recent activity</h2>
          <p>Every add, edit, or delete to courses & products is logged here automatically.</p>
        </div>
      </div>
      <div id="activityList"></div>
    </div>`;

  const list = document.getElementById("activityList");
  if (!activity.length) {
    list.innerHTML = `<div class="empty-state">No activity yet — changes you make to courses or products will show up here.</div>`;
  } else {
    list.innerHTML = activity.map((a) => {
      const name = a.table_name === "courses" ? "course" : "product";
      const actionWord = { insert: "added a", update: "edited a", "delete": "deleted a" }[a.action] || a.action;
      const label = (a.new_data && (a.new_data.title_en || a.new_data.name_en)) || (a.old_data && (a.old_data.title_en || a.old_data.name_en)) || "";
      return `<div class="activity-item">
        <span class="activity-dot"></span>
        <div>
          <div>${Admin.escapeHtml(a.changed_by_email || "Someone")} ${actionWord} ${name}${label ? ` — <strong>${Admin.escapeHtml(label)}</strong>` : ""}</div>
          <div class="when">${Admin.timeAgo(a.created_at)}</div>
        </div>
      </div>`;
    }).join("");
  }
})();
