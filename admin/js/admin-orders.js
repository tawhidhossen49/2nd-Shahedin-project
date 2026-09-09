/* =========================================================
   admin-orders.js
   ---------------------------------------------------------
   Every purchase, with the details the buyer actually typed
   at checkout — name, phone, email and delivery address.

   Read the status column, not just the total. Since bKash
   checkout went in, a row is created when someone STARTS a
   payment, so "Awaiting payment" and "Failed" rows are normal
   and are not money you have. Only "Paid" and "Refunded" ones
   count towards revenue, which is what the stat cards do.

   Refunds are issued from here too, straight through bKash —
   see section 28 of schema.sql and supabase/functions/
   bkash-payment.
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
      sections 17 and 28 add the columns this page reads.</div>`;
    return;
  }
  orders = data || [];

  /* Each leg of a refund, so the bKash refund transaction ids are readable
     here rather than only in the bKash portal — those are what you match a
     statement against. An order can have up to 10 of them. */
  const refundsByOrder = {};
  const { data: refundRows } = await c
    .from("order_refunds")
    .select("order_id, refund_trx_id, amount_bdt, created_at")
    .order("created_at", { ascending: true });
  (refundRows || []).forEach((r) => {
    (refundsByOrder[r.order_id] = refundsByOrder[r.order_id] || []).push(r);
  });

  const money = (n) => "৳" + Number(n || 0).toLocaleString("en-US");
  // A product order with an address is the one that needs a human to act.
  const needsShipping = (o) => o.kind === "product" && !!(o.shipping_address || "").trim();

  /* Money actually taken. Orders are written BEFORE the customer pays now, so
     the table holds abandoned attempts too — summing every row would report
     revenue that never arrived. A refund comes straight back off the top. */
  const paid = (o) => o.status === "completed" || o.status === "refunded";
  const netPaid = (o) => (paid(o) ? (Number(o.amount_bdt) || 0) - (Number(o.refunded_bdt) || 0) : 0);
  const unpaid = (o) => o.status === "pending" || o.status === "failed" || o.status === "cancelled";
  const refundable = (o) => o.status === "completed" && !!o.bkash_trx_id && netPaid(o) > 0;

  const STATUS_BADGE = {
    completed: ["badge-live", "Paid"],
    refunded: ["badge-draft", "Refunded"],
    pending: ["badge-draft", "Awaiting payment"],
    failed: ["badge-draft", "Failed"],
    cancelled: ["badge-draft", "Cancelled"],
  };

  function matches(o) {
    if (filter === "course" && o.kind !== "course") return false;
    if (filter === "product" && o.kind !== "product") return false;
    if (filter === "needs_shipping" && !needsShipping(o)) return false;
    if (filter === "unpaid" && !unpaid(o)) return false;
    if (!search) return true;
    const hay = [o.item_title, o.buyer_name, o.buyer_phone, o.buyer_email, o.shipping_address, o.coupon_code, o.bkash_trx_id]
      .filter(Boolean).join(" ").toLowerCase();
    return hay.includes(search);
  }

  function render() {
    const revenue = orders.reduce((s, o) => s + netPaid(o), 0);
    const refunded = orders.reduce((s, o) => s + (Number(o.refunded_bdt) || 0), 0);
    const shipping = orders.filter((o) => needsShipping(o) && paid(o)).length;
    const waiting = orders.filter((o) => o.status === "pending").length;

    content.innerHTML = `
      <div class="stat-grid">
        <div class="stat-card"><div class="label">Paid orders</div><div class="value">${orders.filter(paid).length}</div><div class="sub">of ${orders.length} started</div></div>
        <div class="stat-card"><div class="label">Revenue</div><div class="value">${money(revenue)}</div><div class="sub">${refunded > 0 ? `after ${money(refunded)} refunded` : "paid orders only"}</div></div>
        <div class="stat-card"><div class="label">Awaiting payment</div><div class="value">${waiting}</div><div class="sub">started, never finished</div></div>
        <div class="stat-card"><div class="label">To ship</div><div class="value">${shipping}</div><div class="sub">paid, physical, has an address</div></div>
      </div>

      <div class="panel">
        <div class="sub-toolbar">
          <div class="filter-tabs">
            ${[["all", "All"], ["course", "Courses"], ["product", "Products"], ["needs_shipping", "To ship"], ["unpaid", "Unpaid"]]
              .map(([id, label]) => `<button type="button" class="btn btn-sm ${filter === id ? "btn-primary" : "btn-ghost"}" data-filter="${id}">${label}</button>`)
              .join("")}
          </div>
          <input type="search" class="sub-search" id="orderSearch" placeholder="Search name, phone, item, address…" value="${Admin.escapeHtml(search)}">
          <button type="button" class="btn btn-ghost btn-sm" id="exportBtn">Export CSV</button>
          <button type="button" class="btn btn-ghost btn-sm" id="bkashLogTxtBtn" title="Every bKash API request and response, for bKash's UAT review">bKash log .txt</button>
          <button type="button" class="btn btn-ghost btn-sm" id="bkashLogJsonBtn" title="The same calls as raw JSON">.json</button>
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
    document.getElementById("bkashLogTxtBtn").addEventListener("click", () => exportBkashLog("txt"));
    document.getElementById("bkashLogJsonBtn").addEventListener("click", () => exportBkashLog("json"));

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
          <thead><tr><th>Item</th><th>Buyer</th><th>Delivery</th><th>Payment</th><th>When</th><th></th></tr></thead>
          <tbody>${shown.map(rowHtml).join("")}</tbody>
        </table>`;

      list.querySelectorAll("[data-refund]").forEach((btn) =>
        btn.addEventListener("click", () => refund(btn.dataset.refund, btn))
      );
    }
  }

  function rowHtml(o) {
    const discount = Number(o.discount_bdt) || 0;
    const sub = o.subtotal_bdt == null ? o.amount_bdt : o.subtotal_bdt;
    const refundedSoFar = Number(o.refunded_bdt) || 0;
    const [badgeClass, badgeText] = STATUS_BADGE[o.status] || ["badge-draft", o.status || "unknown"];

    return `
      <tr>
        <td>
          <div class="row-title">${Admin.escapeHtml(o.item_title || "(untitled)")}</div>
          <div class="row-sub">${o.kind === "course" ? "Course" : "Product"}${o.qty > 1 ? ` · ×${o.qty}` : ""}</div>
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
          <div>${money(o.amount_bdt)} <span class="badge ${badgeClass}">${Admin.escapeHtml(badgeText)}</span></div>
          ${discount > 0
            ? `<div class="row-sub">${money(sub)} − ${money(discount)}${o.coupon_code ? ` (${Admin.escapeHtml(o.coupon_code)})` : ""}</div>`
            : ""}
          ${refundedSoFar > 0
            ? `<div class="row-sub">${money(refundedSoFar)} refunded${
                (refundsByOrder[o.id] || [])
                  .filter((r) => r.refund_trx_id)
                  .map((r) => ` · <code>${Admin.escapeHtml(r.refund_trx_id)}</code>`)
                  .join("")
              }</div>`
            : ""}
          <div class="row-sub">${Admin.escapeHtml(o.payment_method || "—")}${
            /* The bKash transaction id is what the customer quotes and what
               you search for in the bKash merchant portal, so it belongs on
               the row rather than one click away. */
            o.bkash_trx_id ? ` · <code>${Admin.escapeHtml(o.bkash_trx_id)}</code>` : ""
          }</div>
          ${o.failure_reason ? `<div class="row-sub">${Admin.escapeHtml(o.failure_reason)}</div>` : ""}
        </td>
        <td class="row-sub">${Admin.timeAgo(o.created_at)}</td>
        <td>
          <div class="row-actions">${
            refundable(o)
              ? `<button type="button" class="btn btn-ghost btn-sm" data-refund="${o.id}">Refund</button>`
              : ""
          }</div>
        </td>
      </tr>`;
  }

  /* Refunds go through the bkash-payment Edge Function, never straight to the
     table: the money has to actually leave the merchant wallet before the row
     is allowed to say it did. bKash permits up to 10 partial refunds per
     transaction, within 60 days, capped at what was paid. */
  async function refund(orderId, btn) {
    const order = orders.find((o) => o.id === orderId);
    if (!order) return;

    const remaining = netPaid(order);
    const typed = window.prompt(
      `Refund how much of “${order.item_title}”?\n\nUp to ৳${remaining} can still be refunded. This sends the money back through bKash immediately.`,
      String(remaining)
    );
    if (typed === null) return;

    const amount = Math.floor(Number(typed));
    if (!Number.isFinite(amount) || amount <= 0 || amount > remaining) {
      Admin.toast(`Enter an amount between 1 and ${remaining}.`, true);
      return;
    }

    const reason = (window.prompt("Reason for the refund (the customer does not see this):", "Refunded by merchant") || "").trim();
    if (!reason) return;

    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Refunding…";

    try {
      const { data, error } = await Admin.client().functions.invoke("bkash-payment", {
        body: { action: "refund", orderId, amount, reason },
      });
      if (error) {
        let message = "";
        try {
          const body = await error.context.json();
          message = body && body.error;
        } catch (err) {
          message = "";
        }
        throw new Error(message || "bKash refused the refund.");
      }

      order.refunded_bdt = Number(data.refunded) || amount;
      if (order.refunded_bdt >= Number(order.amount_bdt)) order.status = "refunded";
      // Mirror what was just written server-side so the new refund's trx id
      // shows without a reload.
      (refundsByOrder[orderId] = refundsByOrder[orderId] || []).push({
        order_id: orderId,
        refund_trx_id: data.refundTrxId,
        amount_bdt: amount,
        created_at: new Date().toISOString(),
      });
      Admin.toast(`Refunded ${money(amount)}${data.refundTrxId ? ` · ${data.refundTrxId}` : ""}`);
      render();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = original;
      Admin.toast(err.message, true);
    }
  }

  /* ---------- bKash API call log ----------------------------------------
     bKash ask for the request and response of every API call made during test
     payments before they approve a live integration. Whoever is running that
     testing needs the file themselves rather than asking someone else to pull
     it off the command line, so it downloads from here.

     Readable by any admin through the "admins can read the bkash api log"
     policy (schema.sql section 30). Credentials were already stripped before
     the rows were written, so the file is safe to send to bKash as-is. */
  function downloadFile(name, text, mime) {
    const url = URL.createObjectURL(new Blob(["﻿" + text], { type: mime + ";charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function exportBkashLog(format) {
    const btn = document.getElementById(format === "txt" ? "bkashLogTxtBtn" : "bkashLogJsonBtn");
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Loading…";

    try {
      const { data, error } = await c
        .from("bkash_api_log")
        .select("id, created_at, api, url, http_status, response_code, error_message, duration_ms, payment_id, request_body, response_body")
        .order("id", { ascending: true })
        .limit(5000);

      if (error) throw error;
      if (!data || !data.length) {
        Admin.toast("No bKash API calls logged yet. Run a test payment first.", true);
        return;
      }

      const stamp = new Date().toISOString().slice(0, 16).replace("T", "_").replace(":", "");

      if (format === "json") {
        downloadFile(`bkash-api-log-${stamp}.json`, JSON.stringify(data, null, 2), "application/json");
      } else {
        const lines = [
          "bKash API call log - Shahedin",
          "Exported: " + new Date().toString(),
          "Calls:    " + data.length,
          "Note:     app_secret, password, id_token, refresh_token and the",
          "          Authorization header are redacted by design.",
          "=".repeat(78),
          "",
        ];
        data.forEach((r) => {
          lines.push(`[${r.id}] ${r.api}  -  ${r.response_code === "0000" ? "SUCCESS" : "FAILED (" + r.response_code + ")"}`);
          lines.push("  Time        : " + r.created_at);
          lines.push("  URL         : POST " + r.url);
          lines.push("  HTTP status : " + (r.http_status == null ? "(no response)" : r.http_status));
          lines.push("  bKash code  : " + (r.response_code || ""));
          if (r.error_message) lines.push("  Message     : " + r.error_message);
          if (r.payment_id) lines.push("  paymentID   : " + r.payment_id);
          lines.push("  Duration    : " + r.duration_ms + " ms");
          lines.push("  Request  --> " + JSON.stringify(r.request_body));
          lines.push("  Response <-- " + JSON.stringify(r.response_body));
          lines.push("-".repeat(78));
        });
        downloadFile(`bkash-api-log-${stamp}.txt`, lines.join("\r\n"), "text/plain");
      }

      Admin.toast(`Exported ${data.length} API call(s).`);
    } catch (err) {
      /* A missing table means section 30 of schema.sql has not been run on
         this database yet - worth saying, because the button otherwise just
         looks broken. */
      const message = /does not exist|could not find/i.test(err.message || "")
        ? "The bkash_api_log table is missing. Run section 30 of schema.sql."
        : err.message || "Could not read the log.";
      Admin.toast(message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  }

  function exportCsv() {
    const shown = orders.filter(matches);
    const head = ["Date", "Kind", "Item", "Qty", "Subtotal", "Discount", "Coupon", "Paid", "Refunded", "Payment", "Status", "bKash trx", "bKash payment id", "Paid at", "Name", "Phone", "Email", "Address"];
    const cell = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
    const csv = [head.map(cell).join(",")]
      .concat(shown.map((o) => [
        o.created_at, o.kind, o.item_title, o.qty,
        o.subtotal_bdt == null ? o.amount_bdt : o.subtotal_bdt,
        o.discount_bdt || 0, o.coupon_code || "", o.amount_bdt, o.refunded_bdt || 0,
        o.payment_method || "", o.status || "",
        // Both ids are here because reconciling against a bKash statement
        // needs the trx id, and chasing a stuck payment needs the payment id.
        o.bkash_trx_id || "", o.bkash_payment_id || "", o.paid_at || "",
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
