(async function () {
  "use strict";
  const admin = await Admin.requireAdmin();
  if (!admin) return;

  Admin.renderShell("analytics.html", "Analytics", "Page views recorded directly from your site — no cookies, no third-party trackers.", admin);
  const content = document.getElementById("adminContent");
  content.innerHTML = `<div class="loading-row"><div class="spinner"></div> Loading analytics…</div>`;

  const c = Admin.client();
  const since = new Date(Date.now() - 30 * 86400000).toISOString();

  /* Two separate questions, because a single select can't answer both.
     Supabase caps any select at 1000 rows, so the old `.select(...).length`
     reported 1000 views forever once the site passed that — and the daily
     average and chart were wrong with it.
       · totalViews comes from an exact server-side COUNT (no rows moved).
       · The per-day chart and top-pages table genuinely need the rows, so
         they're pulled a page at a time. PAGE_CAP stops a very busy month
         from pulling a hundred thousand rows into the browser; if it's hit,
         the chart says so rather than quietly showing a partial picture. */
  const PAGE_SIZE = 1000;
  const PAGE_CAP = 20000;

  const countRes = await c.from("page_views").select("*", { count: "exact", head: true }).gte("viewed_at", since);
  if (countRes.error) {
    content.innerHTML = `<div class="notice">Couldn't load analytics: ${Admin.escapeHtml(countRes.error.message)}</div>`;
    return;
  }
  const totalViews = countRes.count || 0;

  const rows = [];
  let fetchError = null;
  for (let from = 0; from < Math.min(totalViews, PAGE_CAP); from += PAGE_SIZE) {
    const { data, error } = await c
      .from("page_views")
      .select("page_path,referrer,lang,viewed_at")
      .gte("viewed_at", since)
      .order("viewed_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) { fetchError = error; break; }
    if (!data || !data.length) break;
    rows.push(...data);
  }

  if (fetchError && !rows.length) {
    content.innerHTML = `<div class="notice">Couldn't load analytics: ${Admin.escapeHtml(fetchError.message)}</div>`;
    return;
  }
  const sampled = totalViews > rows.length;

  if (!totalViews) {
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
      <div class="stat-card"><div class="label">Views (30 days)</div><div class="value">${totalViews.toLocaleString()}</div></div>
      <div class="stat-card"><div class="label">Daily average</div><div class="value">${Math.round(totalViews / 30).toLocaleString()}</div></div>
      <div class="stat-card"><div class="label">Pages tracked</div><div class="value">${Object.keys(pageCounts).length}</div></div>
    </div>

    <div class="panel">
      <div class="panel-head"><div><h2>Views over the last 30 days</h2>${
        sampled ? `<p>Chart and table are based on the most recent ${rows.length.toLocaleString()} of ${totalViews.toLocaleString()} views. The totals above are exact.</p>` : ""
      }</div></div>
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
