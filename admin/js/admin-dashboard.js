(async function () {
  "use strict";
  const admin = await Admin.requireAdmin();
  if (!admin) return;

  Admin.renderShell("index.html", "Dashboard", `Welcome back, ${Admin.escapeHtml((admin.full_name || admin.email).split("@")[0])}.`, admin);
  const content = document.getElementById("adminContent");
  content.innerHTML = `<div class="loading-row"><div class="spinner"></div> Loading overview…</div>`;

  const c = Admin.client();
  const can = Admin.can;

  /* Counting rows by fetching them and reading .length is why "Page views"
     froze at exactly 1000: Supabase/PostgREST caps any select at 1000 rows,
     so the 1001st view onwards was invisible and both the 30-day and all-time
     figures pinned there forever. `head: true` with `count: "exact"` asks
     Postgres to COUNT server-side and transfers no rows at all — accurate at
     any size, and faster. Read res.count, never res.data.length.

     Each figure is only asked for when this admin may see it. The database
     would answer a limited admin with a silent zero rather than an error
     (that is how row-level security works), and a card reading "0 messages"
     to someone who simply is not allowed to read them would be a lie. */
  const none = Promise.resolve({ count: 0, data: [] });
  const [coursesRes, productsRes, viewsRes, viewsAllRes, logRes, messagesRes, unreadRes] = await Promise.all([
    c.from("courses").select("id,is_published"),
    c.from("products").select("id,is_published"),
    can("analytics") ? c.from("page_views").select("*", { count: "exact", head: true }).gte("viewed_at", new Date(Date.now() - 30 * 86400000).toISOString()) : none,
    can("analytics") ? c.from("page_views").select("*", { count: "exact", head: true }) : none,
    c.from("activity_log").select("*").order("created_at", { ascending: false }).limit(8),
    // Contact form messages. Wrapped in a catch so an older database that
    // hasn't run the latest schema.sql yet still shows the rest of the dashboard.
    can("submissions") ? c.from("contact_submissions").select("*", { count: "exact", head: true }).then((r) => r, () => ({ count: 0 })) : none,
    can("submissions") ? c.from("contact_submissions").select("*", { count: "exact", head: true }).eq("is_read", false).then((r) => r, () => ({ count: 0 })) : none,
  ]);

  const courses = coursesRes.data || [];
  const products = productsRes.data || [];
  const publishedCourses = courses.filter((x) => x.is_published).length;
  const publishedProducts = products.filter((x) => x.is_published).length;
  const views30d = viewsRes.count || 0;
  const viewsAll = viewsAllRes.count || 0;
  const activity = logRes.data || [];
  const messageCount = (messagesRes && messagesRes.count) || 0;
  const unreadMessages = (unreadRes && unreadRes.count) || 0;

  /* "What do you want to do?" -- the panel's pages phrased as jobs, because
     someone who does not use admin panels knows they want to change a price
     long before they know that lives under Courses. Each card is shown only
     to an admin who may open the page behind it. */
  const ICONS = {
    plus: "M12 5v14M5 12h14",
    edit: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z",
    cart: "M9 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM19 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6",
    people: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
    mail: "M4 4h16v16H4zM4 6l8 6 8-6",
    bag: "M6 2 3 7v13a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V7l-3-5H6zM3 7h18M16 11a4 4 0 0 1-8 0",
    tag: "M20 12a2 2 0 0 1 2-2V7a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v3a2 2 0 0 1 0 4v3a1 1 0 0 0 1 1h18a1 1 0 0 0 1-1v-3a2 2 0 0 1-2-2zM13 7v2M13 15v2",
    home: "M3 11l9-8 9 8M5 10v10h14V10",
    phone: "M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z",
    chart: "M4 19V5M4 19h16M9 19V9M14 19v-6M19 19V6",
    star: "M12 2l2.9 6.3 6.9.9-5 4.9 1.2 6.9-6-3.2-6 3.2 1.2-6.9-5-4.9 6.9-.9z",
    team: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM19 8v6M22 11h-6",
    megaphone: "M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13",
  };
  const TASKS = [
    { key: "courses", href: "courses.html?new=1", icon: "plus", title: "Add a new course", desc: "Create a course with its lessons and price." },
    { key: "courses", href: "courses.html", icon: "edit", title: "Change a course", desc: "Edit the name, price, discount, lessons or free preview videos." },
    { key: "orders", href: "orders.html", icon: "cart", title: "See payments", desc: "Who paid, how much, and send a refund if needed." },
    { key: "students", href: "students.html", icon: "people", title: "Find a student", desc: "See what they bought, or give them a course by hand." },
    { key: "submissions", href: "submissions.html", icon: "mail", title: "Read messages", desc: "Messages people sent from the Contact page.", flag: unreadMessages ? `${unreadMessages} new` : "" },
    { key: "products", href: "products.html?new=1", icon: "bag", title: "Add a store product", desc: "A book, notes, or anything else you sell." },
    { key: "coupons", href: "coupons.html", icon: "tag", title: "Make a discount coupon", desc: "A code that gives buyers money off." },
    { key: "reviews", href: "reviews.html", icon: "star", title: "Approve reviews", desc: "Choose which student reviews show on the site." },
    { key: "home", href: "home.html", icon: "home", title: "Edit the homepage", desc: "Change the text, photos and sections visitors see first." },
    { key: "settings", href: "settings.html", icon: "phone", title: "Change contact details", desc: "Phone, email, WhatsApp and social media links." },
    { key: "analytics", href: "analytics.html", icon: "chart", title: "See visitor numbers", desc: "How many people visit, and which pages." },
    { key: "ads", href: "ads.html", icon: "megaphone", title: "Facebook ads", desc: "Turn Facebook ad tracking on or off, and check it works." },
    { key: "team", href: "team.html", icon: "team", title: "Add a team member", desc: "Let someone else log in, and choose what they can use." },
  ].filter((t) => can(t.key));

  const taskHtml = TASKS.map((t) => `
      <a class="task-card" href="${t.href}">
        <span class="task-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${ICONS[t.icon]}"/></svg></span>
        <b>${t.title}</b>
        <span class="task-desc">${t.desc}</span>
        ${t.flag ? `<span class="badge badge-free task-flag">${t.flag}</span>` : ""}
      </a>`).join("");

  // Sent here by requireAdmin() after trying to open a page that is not theirs.
  const refused = new URLSearchParams(location.search).get("noaccess");
  const refusedHtml = refused
    ? `<div class="notice">You don't have access to <strong>${Admin.escapeHtml(refused)}</strong>. If you need it, ask a main admin to switch it on for you under Team &amp; access.</div>`
    : "";
  const emptyHtml = !TASKS.length
    ? `<div class="notice">Your login works, but no pages have been switched on for you yet. Ask a main admin to choose your pages under Team &amp; access.</div>`
    : "";

  content.innerHTML = `
    ${refusedHtml}
    ${emptyHtml}
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
      ${can("analytics") ? `
      <div class="stat-card">
        <div class="label">Page views (30d)</div>
        <div class="value">${views30d}</div>
        <div class="sub">${viewsAll} all-time</div>
      </div>` : ""}
      ${can("submissions") ? `
      <div class="stat-card">
        <div class="label">Contact messages</div>
        <div class="value">${messageCount}</div>
        <div class="sub">${unreadMessages ? `${unreadMessages} unread` : "all read"}</div>
      </div>` : ""}
    </div>

    ${TASKS.length ? `
    <div class="panel">
      <div class="panel-head">
        <div>
          <h2>What do you want to do?</h2>
          <p>Press a box to go straight there. The menu has everything else.</p>
        </div>
      </div>
      <div class="task-grid">${taskHtml}</div>
    </div>` : ""}

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
      const label = (a.new_data && (a.new_data.title_bn || a.new_data.name_bn || a.new_data.title_en || a.new_data.name_en)) || (a.old_data && (a.old_data.title_bn || a.old_data.name_bn || a.old_data.title_en || a.old_data.name_en)) || "";
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
