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

  const BN = "০১২৩৪৫৬৭৮৯";
  const bn = (n) => String(n).replace(/[0-9]/g, (d) => BN[+d]);
  const taka = (n) => "৳" + bn(Number(n || 0).toLocaleString("en-US"));

  let item = null;   // { kind, dbId, slug, title, price, qty }
  let coupon = null; // { code, discount_bdt } once a code has been validated

  const COUPON_ERRORS = {
    empty: "একটি কুপন কোড লিখুন।",
    not_found: "এই কুপন কোডটি পাওয়া যায়নি।",
    inactive: "এই কুপনটি আর সক্রিয় নেই।",
    expired: "এই কুপনের মেয়াদ শেষ হয়ে গেছে।",
    used_up: "এই কুপনটি সর্বোচ্চ সংখ্যকবার ব্যবহার হয়ে গেছে।",
  };

  function subtotal() {
    return item ? item.price * item.qty : 0;
  }

  function discount() {
    return coupon ? Math.min(coupon.discount_bdt, subtotal()) : 0;
  }

  function total() {
    return Math.max(0, subtotal() - discount());
  }

  function findItem(data) {
    const courseSlug = qs("course");
    const productSlug = qs("product");
    const qty = Math.max(1, parseInt(qs("qty") || "1", 10));

    if (courseSlug) {
      const c = (data.courses || []).find((x) => x.id === courseSlug);
      if (c) return { kind: "course", dbId: c.dbId || null, slug: c.id, title: c.title, price: c.free ? 0 : c.price, qty: 1, image: c.image || null, type: "digital" };
    }
    if (productSlug) {
      const p = (data.products || []).find((x) => x.id === productSlug);
      if (p) return { kind: "product", dbId: p.dbId || null, slug: p.id, title: p.title, price: p.price, qty, image: p.image || null, type: p.type || "digital" };
    }
    return null;
  }

  /* The delivery step only exists for something that physically ships.
     `required` is added and removed with it: a hidden required field blocks
     submission with a validation bubble the buyer cannot see or reach. */
  function syncDeliveryStep() {
    const group = document.querySelector("[data-delivery-group]");
    const address = document.getElementById("coAddress");
    const paymentStep = document.querySelector("[data-payment-step]");
    if (!group || !address) return;

    const physical = !!item && item.type === "physical";
    group.hidden = !physical;
    if (physical) address.setAttribute("required", "");
    else address.removeAttribute("required");
    // Payment is step 2 for a digital order, step 3 once delivery appears.
    if (paymentStep) paymentStep.textContent = physical ? "৩" : "২";
  }

  // Marks the page as un-purchasable, hiding the form, the coupon box and the
  // submit button together so no orphan control is left pointing at nothing.
  function setUnavailable(on) {
    const layout = document.querySelector(".checkout-layout");
    if (layout) layout.classList.toggle("is-unavailable", on);
  }

  const PLACEHOLDER_ICON =
    '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.6"/><path d="m21 15-5-5L5 21"/></svg>';

  function renderSummary() {
    const mount = document.querySelector("[data-mount='order-summary']");
    if (!mount) return;

    if (!item) {
      mount.innerHTML = `<div class="empty-state"><p>কোনো আইটেম নির্বাচন করা হয়নি। <a class="text-link" href="courses.html">কোর্স ব্রাউজ করুন</a> অথবা <a class="text-link" href="store.html">স্টোর দেখুন</a>।</p></div>`;
      setUnavailable(true);
      return;
    }

    const sub = subtotal();
    const off = discount();
    const due = total();
    mount.innerHTML = `
      <div class="order-summary">
        <div class="osr-item">
          <div class="osr-thumb">${
            item.image
              ? `<img src="${escapeHtml(item.image)}" alt="" decoding="async">`
              : PLACEHOLDER_ICON
          }</div>
          <div class="osr-item-body">
            <div class="osr-title">${escapeHtml(item.title)}</div>
            <div class="osr-sub">${item.kind === "course" ? "কোর্স" : `প্রোডাক্ট${item.qty > 1 ? ` · পরিমাণ ${bn(item.qty)}` : ""}`}</div>
          </div>
          <div class="osr-item-price">${sub === 0 ? "ফ্রি" : taka(sub)}</div>
        </div>
        <div class="order-summary-row">
          <div><div class="osr-title">সাবটোটাল</div></div>
          <div>${sub === 0 ? "ফ্রি" : taka(sub)}</div>
        </div>
        ${off > 0
          ? `<div class="order-summary-row discount">
               <div><div class="osr-title">ছাড়</div><div class="osr-sub">কুপন ${escapeHtml(coupon.code)}</div></div>
               <div>−${taka(off)}</div>
             </div>`
          : ""}
        <div class="order-summary-row total"><span>সর্বমোট</span><span>${taka(due)}</span></div>
      </div>`;

    if (!item.dbId) {
      mount.innerHTML += `<div class="notice">এই আইটেমটি Supabase-এর সাথে সংযুক্ত নয় (ডেমো ডেটা), তাই অর্ডার সম্পন্ন করা যাবে না।</div>`;
      setUnavailable(true);
      return;
    }
    setUnavailable(false);
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

  /* ---------- Coupons ----------
     The `coupons` table has no public read policy on purpose — a visitor must
     not be able to list every code you have issued. validate_coupon() is a
     SECURITY DEFINER function that answers about one code at a time and
     returns the discount it would give, so the browser never sees the table.
     The discount is recomputed server-side from the order row's own subtotal
     when the order is written, so a tampered client can't invent a price. */
  function setCouponStatus(text, kind) {
    const el = document.getElementById("couponStatus");
    if (!el) return;
    el.textContent = text || "";
    el.hidden = !text;
    el.classList.toggle("is-error", kind === "error");
    el.classList.toggle("is-ok", kind === "ok");
  }

  async function applyCoupon() {
    const input = document.getElementById("coCoupon");
    const btn = document.getElementById("couponApplyBtn");
    if (!input || !item) return;

    const code = input.value.trim().toUpperCase();
    if (!code) {
      coupon = null;
      renderSummary();
      setCouponStatus(COUPON_ERRORS.empty, "error");
      return;
    }

    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = "দেখা হচ্ছে…";
    try {
      const c = window.ShahedinAuth.client();
      const { data, error } = await c.rpc("validate_coupon", { p_code: code, p_subtotal: subtotal() });
      if (error) throw error;

      if (!data || !data.valid) {
        coupon = null;
        renderSummary();
        const reason = data && data.reason;
        setCouponStatus(
          reason === "min_order"
            ? `এই কুপনটি ব্যবহার করতে সর্বনিম্ন ${taka(data.min_order_bdt)} মূল্যের অর্ডার প্রয়োজন।`
            : COUPON_ERRORS[reason] || "কুপনটি প্রয়োগ করা যায়নি।",
          "error"
        );
        return;
      }

      coupon = { code: data.code, discount_bdt: Number(data.discount_bdt) || 0 };
      input.value = data.code;
      renderSummary();
      setCouponStatus(`${taka(discount())} ছাড় প্রয়োগ করা হয়েছে।`, "ok");
    } catch (err) {
      coupon = null;
      renderSummary();
      // An older database that hasn't run the latest schema.sql has no
      // validate_coupon function; say so rather than blaming the code.
      setCouponStatus("কুপন যাচাই করা যায়নি, একটু পরে আবার চেষ্টা করুন।", "error");
      console.warn("Shahedin checkout: coupon validation failed.", err);
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
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
      const field = (name) => {
        const el = form.querySelector(`[name="${name}"]`);
        return el ? el.value.trim() : "";
      };

      /* The buyer's details used to be collected and then dropped on the
         floor — only the item, quantity and amount were saved, so a physical
         order reached the admin with no name, phone or address on it. They
         are part of the order row now, and visible in Admin → Orders. */
      const base = {
        user_id: user.id,
        kind: item.kind,
        item_id: item.dbId,
        item_title: item.title,
        qty: item.qty,
        amount_bdt: total(),
        payment_method: form.payment_method.value,
        status: "completed",
      };
      const withDetails = Object.assign({}, base, {
        subtotal_bdt: subtotal(),
        discount_bdt: discount(),
        coupon_code: coupon ? coupon.code : null,
        buyer_name: field("name") || null,
        buyer_phone: field("phone") || null,
        buyer_email: field("email") || null,
        shipping_address: field("address") || null,
      });

      let { error: orderErr } = await c.from("orders").insert(withDetails);

      /* If section 17 of schema.sql hasn't been run yet those columns don't
         exist, and the whole order would fail. Better to save the sale and
         lose the extra detail than to lose the customer's purchase — but say
         so loudly in the console so it gets fixed. */
      if (orderErr && /column .* does not exist|could not find/i.test(orderErr.message || "")) {
        console.warn(
          "Shahedin checkout: the orders table is missing the buyer-detail columns, so this order was saved " +
          "without the buyer's name, phone, email, address or coupon. Run section 17 of schema.sql in the " +
          "Supabase SQL editor to fix this.",
          orderErr
        );
        ({ error: orderErr } = await c.from("orders").insert(base));
      }
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
    syncDeliveryStep();
    prefillFromUser();
    const form = document.getElementById("checkoutForm");
    if (form) form.addEventListener("submit", handleSubmit);

    const couponBtn = document.getElementById("couponApplyBtn");
    if (couponBtn) couponBtn.addEventListener("click", applyCoupon);
    const couponInput = document.getElementById("coCoupon");
    if (couponInput) {
      // Enter inside the coupon box applies the code; it must not submit the
      // whole order, which is what a bare Enter in a form field would do.
      couponInput.addEventListener("keydown", (ev) => {
        if (ev.key !== "Enter") return;
        ev.preventDefault();
        applyCoupon();
      });
      // Editing the code after applying invalidates it until re-applied,
      // so the summary can never show a discount the input no longer matches.
      couponInput.addEventListener("input", () => {
        if (!coupon) return;
        if (couponInput.value.trim().toUpperCase() !== coupon.code) {
          coupon = null;
          renderSummary();
          setCouponStatus("কোড পরিবর্তন করা হয়েছে — আবার “প্রয়োগ করুন” চাপুন।", "error");
        }
      });
    }
  });
})();
