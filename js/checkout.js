/* =========================================================
   checkout.js
   ---------------------------------------------------------
   Single-item checkout. Reads ?course=slug or ?product=slug
   (&qty=N for products) from the URL, requires the student to
   be logged in, shows a real order summary, and on submit
   writes a real row to `orders` (and to `enrollments` too, if
   it's a course) — no more fake "front-end mock" no-op.
   ========================================================= */
(function () {
  "use strict";

  function escapeHtml(str) {
    return (str == null ? "" : String(str)).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  }

  function qs(name) {
    return new URLSearchParams(window.location.search).get(name);
  }

  let item = null; // { kind, dbId, slug, title, price, qty }

  function findItem(data) {
    const courseSlug = qs("course");
    const productSlug = qs("product");
    const qty = Math.max(1, parseInt(qs("qty") || "1", 10));

    if (courseSlug) {
      const c = (data.courses || []).find((x) => x.id === courseSlug);
      if (c) return { kind: "course", dbId: c.dbId || null, slug: c.id, title: c.title, price: c.free ? 0 : c.price, qty: 1 };
    }
    if (productSlug) {
      const p = (data.products || []).find((x) => x.id === productSlug);
      if (p) return { kind: "product", dbId: p.dbId || null, slug: p.id, title: p.title, price: p.price, qty };
    }
    return null;
  }

  function renderSummary() {
    const mount = document.querySelector("[data-mount='order-summary']");
    const form = document.getElementById("checkoutForm");
    if (!mount) return;

    if (!item) {
      mount.innerHTML = `<div class="empty-state"><p>কোনো আইটেম নির্বাচন করা হয়নি। <a class="text-link" href="courses.html">কোর্স ব্রাউজ করুন</a> অথবা <a class="text-link" href="store.html">স্টোর দেখুন</a>।</p></div>`;
      if (form) form.style.display = "none";
      return;
    }

    const total = item.price * item.qty;
    mount.innerHTML = `
      <div class="order-summary">
        <div class="order-summary-row">
          <div>
            <div class="osr-title">${escapeHtml(item.title)}</div>
            <div class="osr-sub">${item.kind === "course" ? "কোর্স" : `প্রোডাক্ট${item.qty > 1 ? ` · পরিমাণ ${item.qty}` : ""}`}</div>
          </div>
          <div>${total === 0 ? "ফ্রি" : "৳" + total}</div>
        </div>
        <div class="order-summary-row total"><span>সর্বমোট</span><span>${total === 0 ? "৳০" : "৳" + total}</span></div>
      </div>`;

    if (!item.dbId) {
      mount.innerHTML += `<div class="notice">এই আইটেমটি Supabase-এর সাথে সংযুক্ত নয় (ডেমো ডেটা), তাই অর্ডার সম্পন্ন করা যাবে না।</div>`;
      if (form) form.style.display = "none";
    }
  }

  async function prefillFromUser() {
    if (!window.ShahedinAuth) return;
    const user = await window.ShahedinAuth.requireAuth();
    if (!user) return;
    const form = document.getElementById("checkoutForm");
    if (!form) return;
    if (form.name && !form.name.value) form.name.value = window.ShahedinAuth.displayName(user);
    if (form.phone && !form.phone.value) form.phone.value = window.ShahedinAuth.formatPhone(user.phone);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!item || !item.dbId) return;
    const btn = document.getElementById("checkoutSubmitBtn");
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = "প্রসেস হচ্ছে…";

    try {
      const user = await window.ShahedinAuth.requireAuth();
      if (!user) { btn.disabled = false; btn.textContent = original; return; }

      const c = window.ShahedinAuth.client();
      const form = document.getElementById("checkoutForm");
      const total = item.price * item.qty;

      const { error: orderErr } = await c.from("orders").insert({
        user_id: user.id,
        kind: item.kind,
        item_id: item.dbId,
        item_title: item.title,
        qty: item.qty,
        amount_bdt: total,
        payment_method: form.payment_method.value,
        status: "completed",
      });
      if (orderErr) throw orderErr;

      if (item.kind === "course") {
        const { error: enrollErr } = await c.from("enrollments").upsert({ user_id: user.id, course_id: item.dbId }, { onConflict: "user_id,course_id" });
        if (enrollErr) throw enrollErr;
      }

      sessionStorage.setItem("shahedin_purchase_success", item.kind === "course" ? "course" : "product");
      window.location.href = "dashboard.html";
    } catch (err) {
      window.showToast && window.showToast("অর্ডার সম্পন্ন করা যায়নি, আবার চেষ্টা করুন।");
      btn.disabled = false;
      btn.textContent = original;
    }
  }

  document.addEventListener("sitedata-ready", () => {
    item = findItem(window.SITE_DATA || {});
    renderSummary();
    prefillFromUser();
    const form = document.getElementById("checkoutForm");
    if (form) form.addEventListener("submit", handleSubmit);
  });
})();
