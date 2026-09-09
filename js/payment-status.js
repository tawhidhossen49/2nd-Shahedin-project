/* =========================================================
   payment-status.js
   ---------------------------------------------------------
   The page bKash returns the customer to.

   The ?status= in the URL is NOT taken as the answer. It came
   back through the customer's own browser, so it is treated as
   a hint about what to expect and nothing more. The real state
   is read from the bkash-payment Edge Function, which asks
   bKash directly when the order is still unsettled.

   That check runs ONCE per page load. See the note in run():
   automatic retries turn into repeated Query Payment calls,
   which is the one thing bKash's review does not allow.

   That also covers the case this page exists for: the customer
   closed the bKash tab, the callback never ran, and the money
   left their wallet anyway. Opening this page settles it.
   ========================================================= */
(function () {
  "use strict";

  const BN = "০১২৩৪৫৬৭৮৯";
  const bn = (n) => String(n).replace(/[0-9]/g, (d) => BN[+d]);
  const taka = (n) => "৳" + bn(Number(n || 0).toLocaleString("en-US"));

  function escapeHtml(str) {
    return (str == null ? "" : String(str)).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  }

  const mount = document.querySelector("[data-mount='payment-status']");
  const params = new URLSearchParams(window.location.search);
  const orderId = params.get("order");

  const ICONS = {
    good: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
    bad: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6M9 9l6 6"/></svg>',
    wait: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  };

  function paint(opts) {
    mount.innerHTML = `
      <div class="empty-state${opts.variant === "error" ? " state-error" : ""}${opts.variant === "good" ? " state-good" : ""}">
        <span class="empty-icon">${opts.icon}</span>
        <h3>${escapeHtml(opts.title)}</h3>
        ${opts.body ? `<p>${escapeHtml(opts.body)}</p>` : ""}
        ${opts.meta ? `<p class="payment-status-meta">${opts.meta}</p>` : ""}
        <div class="payment-status-actions">
          ${(opts.actions || [])
            .map((a) => `<a href="${escapeHtml(a.href)}" class="btn ${a.primary ? "btn-primary" : "btn-ghost"}">${escapeHtml(a.text)}</a>`)
            .join("")}
        </div>
      </div>`;
  }

  // Where "try again" should send someone whose payment did not go through.
  function retryHref(order) {
    if (!order || !order.slug) return order && order.kind === "course" ? "courses.html" : "store.html";
    return order.kind === "course"
      ? `checkout.html?course=${encodeURIComponent(order.slug)}`
      : `checkout.html?product=${encodeURIComponent(order.slug)}`;
  }

  function showCompleted(order) {
    /* The dashboard shows its own confirmation toast when it sees this, so a
       buyer who clicks through gets told again in the place they land. */
    try {
      sessionStorage.setItem("shahedin_purchase_success", order.kind === "course" ? "course" : "product");
    } catch (err) {
      // Private mode with storage blocked — the toast is a nicety, not the receipt.
    }

    paint({
      variant: "good",
      icon: ICONS.good,
      title: "পেমেন্ট সফল হয়েছে",
      body:
        order.kind === "course"
          ? `“${order.title}” কোর্সে আপনার ভর্তি সম্পন্ন হয়েছে। এখনই শুরু করতে পারেন।`
          : `“${order.title}” অর্ডারটি নিশ্চিত হয়েছে।`,
      // The bKash transaction id is the customer's receipt — it is what
      // support will ask for, so it must be on screen, not just in an email.
      meta: `${taka(order.amount)} পরিশোধিত${order.trxId ? ` · ট্রানজেকশন আইডি <strong>${escapeHtml(order.trxId)}</strong>` : ""}`,
      actions: [
        { href: "dashboard.html", text: order.kind === "course" ? "ড্যাশবোর্ডে যান" : "আমার অর্ডার দেখুন", primary: true },
      ],
    });
  }

  function showFailed(order, cancelled) {
    paint({
      variant: "error",
      icon: ICONS.bad,
      title: cancelled ? "পেমেন্ট বাতিল করা হয়েছে" : "পেমেন্ট সম্পন্ন হয়নি",
      body: cancelled
        ? "আপনি পেমেন্টটি বাতিল করেছেন। কোনো টাকা কাটা হয়নি।"
        : (order && order.reason) || "bKash পেমেন্টটি সম্পন্ন করতে পারেনি। কোনো টাকা কাটা হয়ে থাকলে তা স্বয়ংক্রিয়ভাবে ফেরত যাবে।",
      actions: [
        { href: retryHref(order), text: "আবার চেষ্টা করুন", primary: true },
        { href: "contact.html", text: "সহায়তা নিন" },
      ],
    });
  }

  function showUnsettled(order) {
    paint({
      variant: "",
      icon: ICONS.wait,
      title: "পেমেন্ট যাচাই করা হচ্ছে",
      body:
        "bKash এখনো এই পেমেন্টের চূড়ান্ত ফলাফল জানায়নি। আপনার অ্যাকাউন্ট থেকে টাকা কেটে থাকলে সেটি নিশ্চিত হয়ে যাবে — এই পেজটি একটু পরে রিফ্রেশ করুন।",
      meta: orderId ? `অর্ডার আইডি <strong>${escapeHtml(orderId)}</strong>` : "",
      actions: [
        { href: window.location.href, text: "আবার দেখুন", primary: true },
        { href: "contact.html", text: "সহায়তা নিন" },
      ],
    });
  }

  function showUnknown() {
    paint({
      variant: "error",
      icon: ICONS.bad,
      title: "পেমেন্টের তথ্য পাওয়া যায়নি",
      body: "এই লিংকে কোনো অর্ডার খুঁজে পাওয়া যায়নি। আপনি টাকা পরিশোধ করে থাকলে আমাদের সাথে যোগাযোগ করুন — আমরা দেখে নিশ্চিত করব।",
      actions: [
        { href: "dashboard.html", text: "ড্যাশবোর্ডে যান", primary: true },
        { href: "contact.html", text: "সহায়তা নিন" },
      ],
    });
  }

  async function fetchStatus(client) {
    const { data, error } = await client.functions.invoke("bkash-payment", {
      body: { action: "status", orderId },
    });
    if (error) throw error;
    return data && data.order ? data.order : null;
  }

  async function run() {
    if (!mount) return;

    if (!orderId) {
      showUnknown();
      return;
    }

    if (!window.ShahedinAuth || !window.ShahedinAuth.configured()) {
      showUnknown();
      return;
    }

    /* An order is only ever readable by the person who placed it, so the
       server needs a session. They will normally still be signed in from
       before they left for bKash; if the session was lost, the login modal
       brings them back to exactly this URL. */
    const user = await window.ShahedinAuth.requireAuth();
    if (!user) {
      paint({
        variant: "",
        icon: ICONS.wait,
        title: "পেমেন্টের অবস্থা দেখতে লগইন করুন",
        body: "নিরাপত্তার জন্য অর্ডারের তথ্য শুধু অ্যাকাউন্টের মালিকই দেখতে পারেন।",
        actions: [{ href: window.location.href, text: "আবার চেষ্টা করুন", primary: true }],
      });
      return;
    }

    const client = window.ShahedinAuth.client();

    /* EXACTLY ONE server check per page load, and no automatic retry.

       This used to poll six times at four-second intervals while an order
       stayed pending. Each of those became a Query Payment call to bKash, and
       a customer who reloaded turned one abandoned checkout into twelve
       queries in under a minute. bKash allow Query only as a fallback for an
       Execute that gave no answer, and grade the call sequence during their
       review — a burst like that reads as polling in the normal flow, whatever
       the intent behind it.

       Nothing is lost by asking once. In a normal successful payment the
       callback has already settled the order, so no query happens at all. When
       the callback did not run, one query finds the answer. And if bKash
       genuinely has not settled yet, the customer gets an explicit "আবার
       দেখুন" button — a person choosing to check again, which is a defensible
       thing to see in a log, rather than a script hammering the endpoint. */
    let order;
    try {
      order = await fetchStatus(client);
    } catch (err) {
      showUnsettled(null);
      return;
    }

    if (!order) {
      showUnknown();
      return;
    }
    if (order.status === "completed" || order.status === "refunded") {
      showCompleted(order);
      return;
    }
    if (order.status === "cancelled") {
      showFailed(order, true);
      return;
    }
    if (order.status === "failed") {
      showFailed(order, false);
      return;
    }
    showUnsettled(order);
  }

  run();
})();
