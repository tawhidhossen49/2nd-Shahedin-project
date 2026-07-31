(async function () {
  "use strict";
  const admin = await Admin.requireAdmin();
  if (!admin) return;

  Admin.renderShell("analytics.html", "Analytics", "Page views recorded directly from your site — no cookies, no third-party trackers.", admin);
  const content = document.getElementById("adminContent");
  content.innerHTML = `<div class="loading-row"><div class="spinner"></div> Loading analytics…</div>`;

  const c = Admin.client();
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const { data, error } = await c.from("page_views").select("page_path,referrer,lang,viewed_at").gte("viewed_at", since);

  if (error) {
    content.innerHTML = `<div class="notice">Couldn't load analytics: ${Admin.escapeHtml(error.message)}</div>`;
    return;
  }

  const rows = data || [];

  if (!rows.length) {
    content.innerHTML = `<div class="empty-state">No page views recorded yet. Once your site is live and connected to Supabase, visits will show up here within a day.</div>`;
    return;
  }

  // Views per day, last 30 days
  const dayBuckets = {};
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    dayBuckets[d.toISOString().slice(0, 10)] = 0;
  }
  rows.forEach((r) => {
    const day = r.viewed_at.slice(0, 10);
    if (day in dayBuckets) dayBuckets[day]++;
  });
  const maxDay = Math.max(1, ...Object.values(dayBuckets));

  // Top pages
  const pageCounts = {};
  rows.forEach((r) => { pageCounts[r.page_path] = (pageCounts[r.page_path] || 0) + 1; });
  const topPages = Object.entries(pageCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);

  content.innerHTML = `
    <div class="stat-grid">
      <div class="stat-card"><div class="label">Views (30 days)</div><div class="value">${rows.length}</div></div>
      <div class="stat-card"><div class="label">Daily average</div><div class="value">${Math.round(rows.length / 30)}</div></div>
      <div class="stat-card"><div class="label">Pages tracked</div><div class="value">${Object.keys(pageCounts).length}</div></div>
    </div>

    <div class="panel">
      <div class="panel-head"><div><h2>Views over the last 30 days</h2></div></div>
      <div style="display:flex; align-items:flex-end; gap:3px; height:140px;">
        ${Object.entries(dayBuckets).map(([day, count]) => `
          <div style="flex:1; display:flex; flex-direction:column; align-items:center; justify-content:flex-end; height:100%;" title="${day}: ${count} views">
            <div style="width:100%; background:var(--accent); border-radius:3px 3px 0 0; height:${Math.max(2, (count / maxDay) * 100)}%; opacity:${count ? 1 : 0.15};"></div>
          </div>`).join("")}
      </div>
      <div style="display:flex; justify-content:space-between; margin-top:8px; font-size:.72rem; color:var(--text-faint);">
        <span>30 days ago</span><span>Today</span>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head"><div><h2>Top pages</h2></div></div>
      <table class="admin-table">
        <thead><tr><th>Page</th><th>Views</th></tr></thead>
        <tbody>${topPages.map(([page, count]) => `<tr><td>${Admin.escapeHtml(page)}</td><td>${count}</td></tr>`).join("")}</tbody>
      </table>
    </div>`;
})();
