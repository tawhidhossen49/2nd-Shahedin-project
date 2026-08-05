/* =========================================================
   admin-orders.js
   ---------------------------------------------------------
   Every purchase, with the details the buyer actually typed
   at checkout — name, phone, email and delivery address.

   Those four used to be collected by checkout.html and then
   discarded: only the item, quantity and amount were written
   to `orders`, so a physical order arrived with nowhere to
   ship it. They are real columns now (see section 17 of
   schema.sql) and this is where you read them.
   ========================================================= */
(async function () {
  "use strict";
  const admin = await Admin.requireAdmin();
  if (!admin) return;

  Admin.renderShell(
    "orders.html",
    "Orders",
    "Course enrolments and store purchases, newest first — including where physical orders need to be shipped.",
    admin
  );
  const content = document.getElementById("adminContent");
  content.innerHTML = `<div class="loading-row"><div class="spinner"></div> Loading orders…</div>`;

  const c = Admin.client();
  let orders = [];
  let filter = "all"; // all | course | product | needs_shipping
  let search = "";

  const { data, error } = await c.from("orders").select("*").order("created_at", { ascending: false }).limit(500);

  if (error) {
    content.innerHTML = `<div class="notice">Couldn't load orders: ${Admin.escapeHtml(error.message)}<br><br>
      If this says the column doesn't exist, re-run <code>schema.sql</code> in the Supabase SQL editor —
      section 17 adds the buyer detail columns this page reads.</div>`;
    return;
  }
  orders = data || [];

  const money = (n) => "৳" + Number(n || 0).toLocaleString("en-US");
  // A product order with an address is the one that needs a human to act.
  const needsShipping = (o) => o.kind === "product" && !!(o.shipping_address || "").trim();

  function matches(o) {
    if (filter === "course" && o.kind !== "course") return false;
    if (filter === "product" && o.kind !== "product") return false;
    if (filter === "needs_shipping" && !needsShipping(o)) return false;
    if (!search) return true;
    const hay = [o.item_title, o.buyer_name, o.buyer_phone, o.buyer_email, o.shipping_address, o.coupon_code]
      .filter(Boolean).join(" ").toLowerCase();
    return hay.includes(search);
  }

  function render() {
    const revenue = orders.reduce((s, o) => s + (Number(o.amount_bdt) || 0), 0);
    const discounted = orders.filter((o) => Number(o.discount_bdt) > 0).length;
    const shipping = orders.filter(needsShipping).length;

    content.innerHTML = `
      <div class="stat-grid">
        <div class="stat-card"><div class="label">Orders</div><div class="value">${orders.length}</div></div>
        <div class="stat-card"><div class="label">Revenue</div><div class="value">${money(revenue)}</div><div class="sub">after discounts</div></div>
        <div class="stat-card"><div class="label">Used a coupon</div><div class="value">${discounted}</div></div>
        <div class="stat-card"><div class="label">To ship</div><div class="value">${shipping}</div><div class="sub">physical, has an address</div></div>
      </div>

      <div class="panel">
        <div class="sub-toolbar">
          <div class="filter-tabs">
            ${[["all", "All"], ["course", "Courses"], ["product", "Products"], ["needs_shipping", "To ship"]]
              .map(([id, label]) => `<button type="button" class="btn btn-sm ${filter === id ? "btn-primary" : "btn-ghost"}" data-filter="${id}">${label}</button>`)
              .join("")}
          </div>
          <input type="search" class="sub-search" id="orderSearch" placeholder="Search name, phone, item, address…" value="${Admin.escapeHtml(search)}">
          <button type="button" class="btn btn-ghost btn-sm" id="exportBtn">Export CSV</button>
        </div>
        <div id="orderList"></div>
      </div>`;

    content.querySelectorAll("[data-filter]").forEach((b) =>
      b.addEventListener("click", () => { filter = b.dataset.filter; render(); })
    );
    const searchEl = document.getElementById("orderSearch");
    searchEl.addEventListener("input", () => {
      search = searchEl.value.trim().toLowerCase();
      renderList();
      // Re-rendering the whole panel would steal focus mid-typing.
    });
    document.getElementById("exportBtn").addEventListener("click", exportCsv);

    renderList();

    function renderList() {
      const list = document.getElementById("orderList");
      const shown = orders.filter(matches);
      if (!shown.length) {
        list.innerHTML = `<div class="empty-state">${
          orders.length ? "No orders match this filter." : "No orders yet. Purchases made on the site will appear here."
        }</div>`;
        return;
      }
      list.innerHTML = `
        <table class="admin-table">
          <thead><tr><th>Item</th><th>Buyer</th><th>Delivery</th><th>Paid</th><th>When</th></tr></thead>
          <tbody>${shown.map(rowHtml).join("")}</tbody>
        </table>`;
    }
  }

  function rowHtml(o) {
    const discount = Number(o.discount_bdt) || 0;
    const sub = o.subtotal_bdt == null ? o.amount_bdt : o.subtotal_bdt;
    return `
      <tr>
        <td>
          <div class="row-title">${Admin.escapeHtml(o.item_title || "(untitled)")}</div>
          <div class="row-sub">${o.kind === "course" ? "Course" : "Product"}${o.qty > 1 ? ` · ×${o.qty}` : ""}
            ${o.status && o.status !== "completed" ? ` · <strong>${Admin.escapeHtml(o.status)}</strong>` : ""}</div>
        </td>
        <td>
          <div>${Admin.escapeHtml(o.buyer_name || "—")}</div>
          <div class="row-sub">${
            [o.buyer_phone, o.buyer_email].filter(Boolean).map(Admin.escapeHtml).join(" · ") || "no contact details"
          }</div>
        </td>
        <td>${
          o.kind === "product"
            ? (o.shipping_address
                ? `<div style="white-space:pre-wrap; max-inline-size:280px;">${Admin.escapeHtml(o.shipping_address)}</div>`
                : `<span class="row-sub">digital / no address given</span>`)
            : `<span class="row-sub">—</span>`
        }</td>
        <td>
          <div>${money(o.amount_bdt)}</div>
          ${discount > 0
            ? `<div class="row-sub">${money(sub)} − ${money(discount)}${o.coupon_code ? ` (${Admin.escapeHtml(o.coupon_code)})` : ""}</div>`
            : ""}
          ${o.payment_method ? `<div class="row-sub">${Admin.escapeHtml(o.payment_method)}</div>` : ""}
        </td>
        <td class="row-sub">${Admin.timeAgo(o.created_at)}</td>
      </tr>`;
  }

  function exportCsv() {
    const shown = orders.filter(matches);
    const head = ["Date", "Kind", "Item", "Qty", "Subtotal", "Discount", "Coupon", "Paid", "Payment", "Status", "Name", "Phone", "Email", "Address"];
    const cell = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
    const csv = [head.map(cell).join(",")]
      .concat(shown.map((o) => [
        o.created_at, o.kind, o.item_title, o.qty,
        o.subtotal_bdt == null ? o.amount_bdt : o.subtotal_bdt,
        o.discount_bdt || 0, o.coupon_code || "", o.amount_bdt,
        o.payment_method || "", o.status || "",
        o.buyer_name || "", o.buyer_phone || "", o.buyer_email || "",
        (o.shipping_address || "").replace(/\r?\n/g, " "),
      ].map(cell).join(",")))
      .join("\r\n");

    // ﻿ so Excel opens the Bangla text as UTF-8 instead of mojibake.
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `shahedin-orders-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  render();
})();
