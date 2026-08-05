/* =========================================================
   admin-coupons.js
   ---------------------------------------------------------
   Create and manage discount codes for checkout.

   The `coupons` table has NO public read policy — visitors
   must never be able to list every code you've issued. The
   checkout page validates one code at a time through the
   validate_coupon() function instead. This page is the only
   place the codes themselves are visible, and it is behind
   the admin guard.

   used_count is maintained by a trigger on `orders`, not by
   the browser, so the tally reflects real purchases and
   can't be inflated by someone hammering the validate call.
   ========================================================= */
(async function () {
  "use strict";
  const admin = await Admin.requireAdmin();
  if (!admin) return;

  Admin.renderShell(
    "coupons.html",
    "Coupons",
    "Discount codes customers can enter at checkout. Deactivate a code to stop it working immediately.",
    admin
  );
  const content = document.getElementById("adminContent");
  content.innerHTML = `<div class="loading-row"><div class="spinner"></div> Loading coupons…</div>`;

  const c = Admin.client();
  let coupons = [];

  async function load() {
    const { data, error } = await c.from("coupons").select("*").order("created_at", { ascending: false });
    if (error) {
      content.innerHTML = `<div class="notice">Couldn't load coupons: ${Admin.escapeHtml(error.message)}<br><br>
        If this says the table doesn't exist, re-run <code>schema.sql</code> in the Supabase SQL editor —
        section 17 creates the <code>coupons</code> table.</div>`;
      return;
    }
    coupons = data || [];
    render();
  }

  const money = (n) => "৳" + Number(n || 0).toLocaleString("en-US");

  function statusOf(v) {
    if (!v.is_active) return { label: "Off", cls: "badge-draft" };
    if (v.expires_at && new Date(v.expires_at) < new Date()) return { label: "Expired", cls: "badge-draft" };
    if (v.max_uses != null && v.used_count >= v.max_uses) return { label: "Used up", cls: "badge-draft" };
    return { label: "Active", cls: "badge-live" };
  }

  /* Coupons are grouped by what they apply to rather than listed as one flat
     table, so a course promotion and a store promotion are never confused for
     each other. Each group has its own "add" button that pre-sets the scope,
     which is the only way an admin reliably gets the scope right. */
  const SCOPES = [
    {
      id: "course",
      title: "Course coupons",
      blurb: "Only work when the customer is buying a course. Ignored in the store.",
      add: "+ Add course coupon",
      empty: 'No course coupons yet. Click "+ Add course coupon" to create one.',
    },
    {
      id: "product",
      title: "Product coupons",
      blurb: "Only work on store products. Ignored on course checkouts.",
      add: "+ Add product coupon",
      empty: 'No product coupons yet. Click "+ Add product coupon" to create one.',
    },
    {
      id: "all",
      title: "Site-wide coupons",
      blurb: "Work on both courses and store products.",
      add: "+ Add site-wide coupon",
      empty: "No site-wide coupons. Use these for something like an Eid sale across everything.",
    },
  ];

  const scopeOf = (v) => (SCOPES.some((s) => s.id === v.applies_to) ? v.applies_to : "all");

  function render() {
    content.innerHTML = SCOPES.map(
      (s) => `
      <div class="panel">
        <div class="panel-head">
          <div>
            <h2>${s.title}</h2>
            <p>${s.blurb}</p>
          </div>
          <button class="btn btn-primary" data-add-scope="${s.id}">${s.add}</button>
        </div>
        <div data-scope-table="${s.id}"></div>
      </div>`
    ).join("") +
      `<p class="hint" style="margin-top:4px;">Codes are not case-sensitive. Customers type them into the coupon box on checkout.</p>`;

    content.querySelectorAll("[data-add-scope]").forEach((b) =>
      b.addEventListener("click", () => openModal(null, b.dataset.addScope))
    );

    SCOPES.forEach((s) => {
      const wrap = content.querySelector(`[data-scope-table="${s.id}"]`);
      const rows = coupons.filter((v) => scopeOf(v) === s.id);
      if (!rows.length) {
        wrap.innerHTML = `<div class="empty-state">${s.empty}</div>`;
        return;
      }
      wrap.innerHTML = `
        <table class="admin-table">
          <thead><tr><th>Code</th><th>Discount</th><th>Conditions</th><th>Used</th><th>Status</th><th></th></tr></thead>
          <tbody>${rows.map(rowHtml).join("")}</tbody>
        </table>`;
    });

    content.querySelectorAll(".edit-btn").forEach((b) => b.addEventListener("click", () => openModal(b.dataset.code)));
    content.querySelectorAll(".del-btn").forEach((b) => b.addEventListener("click", () => remove(b.dataset.code)));
    content.querySelectorAll(".toggle-btn").forEach((b) => b.addEventListener("click", () => toggle(b.dataset.code)));
  }

  function rowHtml(v) {
    const s = statusOf(v);
    const conditions = [
      v.min_order_bdt ? `min ${money(v.min_order_bdt)}` : "",
      v.expires_at ? `until ${new Date(v.expires_at).toLocaleDateString()}` : "no expiry",
    ].filter(Boolean).join(" · ");
    return `
      <tr>
        <td>
          <div class="row-title" style="font-family:var(--font-mono,monospace); letter-spacing:.04em;">${Admin.escapeHtml(v.code)}</div>
          ${v.note ? `<div class="row-sub">${Admin.escapeHtml(v.note)}</div>` : ""}
        </td>
        <td>${v.discount_type === "percent" ? `${v.discount_value}%` : money(v.discount_value)}</td>
        <td class="row-sub">${Admin.escapeHtml(conditions)}</td>
        <td>${v.used_count}${v.max_uses != null ? ` / ${v.max_uses}` : ""}</td>
        <td><span class="badge ${s.cls}">${s.label}</span></td>
        <td>
          <div class="row-actions">
            <button class="btn btn-ghost btn-sm toggle-btn" data-code="${Admin.escapeHtml(v.code)}">${v.is_active ? "Turn off" : "Turn on"}</button>
            <button class="icon-btn edit-btn" data-code="${Admin.escapeHtml(v.code)}" title="Edit"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg></button>
            <button class="icon-btn del-btn" data-code="${Admin.escapeHtml(v.code)}" title="Delete"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6"/></svg></button>
          </div>
        </td>
      </tr>`;
  }

  async function toggle(code) {
    const v = coupons.find((x) => x.code === code);
    if (!v) return;
    const { error } = await c.from("coupons").update({ is_active: !v.is_active }).eq("code", code);
    if (error) { Admin.toast("Couldn't update: " + error.message, true); return; }
    Admin.toast(v.is_active ? `${code} turned off — it stops working immediately.` : `${code} is live.`);
    await load();
  }

  async function remove(code) {
    const v = coupons.find((x) => x.code === code);
    // Deleting a used coupon loses the record of what the discount was; the
    // order rows keep the code as text, but nothing explains it any more.
    const warning = v && v.used_count > 0
      ? `\n\n${code} has already been used ${v.used_count} time(s). Turning it off keeps the history — deleting does not.`
      : "";
    if (!confirm(`Delete the coupon "${code}"? This can't be undone.${warning}`)) return;
    const { error } = await c.from("coupons").delete().eq("code", code);
    if (error) { Admin.toast("Couldn't delete: " + error.message, true); return; }
    Admin.toast("Coupon deleted.");
    await load();
  }

  function openModal(code, presetScope) {
    const v = code ? coupons.find((x) => x.code === code) : null;
    const scope = v ? scopeOf(v) : presetScope || "all";
    const scopeTitle = SCOPES.find((s) => s.id === scope).title.replace(/ coupons$/, "");

    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = `
      <div class="modal" style="max-width:560px;">
        <div class="modal-head">
          <h2>${v ? "Edit coupon" : `New ${scopeTitle.toLowerCase()} coupon`}</h2>
          <button class="modal-close" id="closeModal">&times;</button>
        </div>
        <form id="couponForm">
          <div class="form-grid">
            <div class="form-field">
              <label for="f_code">Code <span class="hint">what the customer types</span></label>
              <input type="text" id="f_code" value="${Admin.escapeHtml(v?.code || "")}" ${v ? "readonly style=\"opacity:.7;cursor:default;\"" : ""} required
                     placeholder="EID25" autocapitalize="characters" spellcheck="false">
            </div>
            <div class="form-field">
              <label for="f_scope">Applies to</label>
              <select id="f_scope">
                <option value="course"  ${scope === "course" ? "selected" : ""}>Courses only</option>
                <option value="product" ${scope === "product" ? "selected" : ""}>Store products only</option>
                <option value="all"     ${scope === "all" ? "selected" : ""}>Everything (courses and products)</option>
              </select>
            </div>
            <div class="form-field">
              <label for="f_type">Discount type</label>
              <select id="f_type">
                <option value="percent" ${v?.discount_type !== "fixed" ? "selected" : ""}>Percent off</option>
                <option value="fixed" ${v?.discount_type === "fixed" ? "selected" : ""}>Fixed ৳ off</option>
              </select>
            </div>
            <div class="form-field">
              <label for="f_value">Amount <span class="hint" id="valueHint">1–100 for percent</span></label>
              <input type="number" id="f_value" min="1" value="${v?.discount_value ?? 10}" required>
            </div>
            <div class="form-field">
              <label for="f_min">Minimum order (৳) <span class="hint">0 = no minimum</span></label>
              <input type="number" id="f_min" min="0" value="${v?.min_order_bdt ?? 0}">
            </div>
            <div class="form-field">
              <label for="f_max">Max uses <span class="hint">blank = unlimited</span></label>
              <input type="number" id="f_max" min="1" value="${v?.max_uses ?? ""}">
            </div>
            <div class="form-field">
              <label for="f_expires">Expires on <span class="hint">blank = never</span></label>
              <input type="date" id="f_expires" value="${v?.expires_at ? new Date(v.expires_at).toISOString().slice(0, 10) : ""}">
            </div>
            <div class="form-field full">
              <label for="f_note">Note <span class="hint">for your own reference — customers never see this</span></label>
              <input type="text" id="f_note" value="${Admin.escapeHtml(v?.note || "")}" placeholder="Eid campaign, Facebook post">
            </div>
            <div class="form-field full">
              <label class="form-check"><input type="checkbox" id="f_active" ${v ? (v.is_active ? "checked" : "") : "checked"}> Active</label>
            </div>
          </div>
          <div class="modal-foot">
            <button type="button" class="btn btn-ghost" id="cancelBtn">Cancel</button>
            <button type="submit" class="btn btn-primary">${v ? "Save changes" : "Create coupon"}</button>
          </div>
        </form>
      </div>`;
    document.body.appendChild(backdrop);

    const close = () => backdrop.remove();
    backdrop.querySelector("#closeModal").addEventListener("click", close);
    backdrop.querySelector("#cancelBtn").addEventListener("click", close);
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });

    // Percent is capped at 100; a fixed amount is not.
    const typeEl = backdrop.querySelector("#f_type");
    const valueEl = backdrop.querySelector("#f_value");
    const hintEl = backdrop.querySelector("#valueHint");
    function syncType() {
      const percent = typeEl.value === "percent";
      valueEl.max = percent ? 100 : "";
      hintEl.textContent = percent ? "1–100 for percent" : "taka taken off the order";
      if (percent && Number(valueEl.value) > 100) valueEl.value = 100;
    }
    typeEl.addEventListener("change", syncType);
    syncType();

    backdrop.querySelector("#couponForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = e.submitter;
      const codeVal = backdrop.querySelector("#f_code").value.trim().toUpperCase();
      if (!codeVal) return;

      const maxRaw = backdrop.querySelector("#f_max").value.trim();
      const expRaw = backdrop.querySelector("#f_expires").value;
      const payload = {
        code: codeVal,
        applies_to: backdrop.querySelector("#f_scope").value,
        discount_type: typeEl.value,
        discount_value: Math.max(1, parseInt(valueEl.value || "1", 10)),
        min_order_bdt: Math.max(0, parseInt(backdrop.querySelector("#f_min").value || "0", 10)),
        max_uses: maxRaw ? Math.max(1, parseInt(maxRaw, 10)) : null,
        // End of the chosen day, so "expires on the 5th" includes the 5th.
        expires_at: expRaw ? new Date(expRaw + "T23:59:59").toISOString() : null,
        note: backdrop.querySelector("#f_note").value.trim() || null,
        is_active: backdrop.querySelector("#f_active").checked,
      };

      btn.disabled = true;
      const original = btn.textContent;
      btn.textContent = "Saving…";
      const { error } = v
        ? await c.from("coupons").update(payload).eq("code", v.code)
        : await c.from("coupons").insert(payload);
      btn.disabled = false;
      btn.textContent = original;

      if (error) {
        Admin.toast(
          error.code === "23505" ? `A coupon with the code ${codeVal} already exists.` : "Couldn't save: " + error.message,
          true
        );
        return;
      }
      Admin.toast(v ? "Coupon updated." : "Coupon created.");
      close();
      await load();
    });
  }

  /* Kick off LAST, after every declaration above has executed.
     `function` declarations hoist, but `const` does not: it sits in the
     temporal dead zone until its line runs. load() calls render(), and
     render() reads the SCOPES const, so starting the fetch higher up threw
     "Cannot access 'SCOPES' before initialization", rejected this async IIFE,
     and left the page showing "Loading coupons..." forever. */
  await load();
})();
