/* =========================================================================
   bkash-payment — start a payment, check one, refund one
   -------------------------------------------------------------------------
   POST { action: "create"  | ... }   start a checkout, get a bKash URL back
   POST { action: "status"  | ... }   what happened to my order?
   POST { action: "refund"  | ... }   admin only

   WHY THIS RUNS ON THE SERVER AT ALL
   The browser must never be the one that says what an order costs. Before
   this function existed, js/checkout.js posted the price it had calculated
   straight into `orders`, so the amount charged was whatever the buyer's
   devtools said it was. Every figure below is read from the database instead:
   the item's price, the coupon's discount, the total. The browser sends a
   slug, a quantity and a coupon code — never money.

   The buyer's Supabase session identifies them, so a request can only ever
   create an order for the person making it.
   ========================================================================= */

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import { BkashError, createPayment, queryPayment, readConfig, refundPayment } from "../_shared/bkash.ts";
import { corsHeaders, fail, json } from "../_shared/http.ts";
import { grantCourse, settleOrder } from "../_shared/orders.ts";

interface Body {
  action?: string;
  kind?: string;
  slug?: string;
  qty?: number;
  coupon_code?: string;
  buyer?: { name?: string; phone?: string; email?: string; address?: string };
  orderId?: string;
  amount?: number;
  reason?: string;
  sku?: string;
}

// Bangla, because every message here is shown to the customer as-is.
const MESSAGES = {
  auth: "অর্ডার করতে হলে আগে লগইন করুন।",
  item: "এই আইটেমটি এখন আর পাওয়া যাচ্ছে না।",
  soldOut: "এই প্রোডাক্টটি স্টকে নেই।",
  stock: "স্টকে এত পিস নেই।",
  enrolled: "আপনি ইতিমধ্যে এই কোর্সে ভর্তি আছেন।",
  gateway: "পেমেন্ট শুরু করা যায়নি, একটু পরে আবার চেষ্টা করুন।",
  coupon: "কুপনটি যাচাই করা যায়নি, একটু পরে আবার চেষ্টা করুন।",
  notFound: "অর্ডারটি পাওয়া যায়নি।",
};

function admin(): SupabaseClient {
  // Service role: this function is the only writer of `orders` now, and it
  // needs to read `courses`/`products`, neither of which is publicly readable.
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
}

async function callerId(db: SupabaseClient, req: Request): Promise<string | null> {
  /* verify_jwt on the platform side only proves the request carried *a* valid
     project token — the public anon key passes that check. This is what proves
     there is a real signed-in person behind it. */
  const header = req.headers.get("Authorization") ?? "";
  const jwt = header.replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return null;
  const { data, error } = await db.auth.getUser(jwt);
  if (error || !data.user) return null;
  return data.user.id;
}

async function isAdmin(db: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await db.from("admins").select("id").eq("id", userId).maybeSingle();
  return !!data;
}

/* bKash pre-fills its wallet-number field from payerReference when the value
   looks like a wallet, which saves the customer typing their own number. The
   checkout field is free text, though, so anything that is not a Bangladeshi
   mobile number is replaced by the invoice — a reference bKash will still show
   on the transaction, without putting nonsense in the wallet box. */
function payerReference(phone: string | undefined, invoice: string): string {
  const digits = (phone ?? "").replace(/\D/g, "").replace(/^880/, "");
  return /^01\d{9}$/.test(digits) ? digits : invoice;
}

/* ---------- create ---------------------------------------------------- */

async function handleCreate(db: SupabaseClient, userId: string, body: Body): Promise<Response> {
  const kind = body.kind === "course" ? "course" : "product";
  const slug = String(body.slug ?? "").trim();
  if (!slug) return fail(MESSAGES.item, 404);

  // Price, title and availability all come from here — never from the request.
  let itemId: string;
  let title: string;
  let unitPrice: number;
  let qty = 1;

  if (kind === "course") {
    const { data: course } = await db
      .from("courses")
      .select("id, title_bn, title_en, price_bdt, is_free, is_published")
      .eq("slug", slug)
      .maybeSingle();
    if (!course || !course.is_published) return fail(MESSAGES.item, 404);

    itemId = course.id;
    title = course.title_bn || course.title_en || slug;
    unitPrice = course.is_free ? 0 : Math.max(0, Number(course.price_bdt) || 0);

    // Paying twice for the same course helps nobody.
    const { data: already } = await db
      .from("enrollments")
      .select("id")
      .eq("user_id", userId)
      .eq("course_id", itemId)
      .maybeSingle();
    if (already) return fail(MESSAGES.enrolled, 409);
  } else {
    const { data: product } = await db
      .from("products")
      .select("id, name_bn, name_en, price_bdt, stock, is_published")
      .eq("slug", slug)
      .maybeSingle();
    if (!product || !product.is_published) return fail(MESSAGES.item, 404);

    itemId = product.id;
    title = product.name_bn || product.name_en || slug;
    unitPrice = Math.max(0, Number(product.price_bdt) || 0);
    qty = Math.min(99, Math.max(1, Math.floor(Number(body.qty) || 1)));

    /* The store page already refuses to sell a sold-out item and caps the
       quantity stepper at the stock left (js/render.js). Same rule again on
       this side, because now there is money involved and the stepper is not
       the only way to reach this endpoint. Stock is not decremented here —
       the admin panel owns the stock number, exactly as it did before. */
    const stock = product.stock === null || product.stock === undefined ? null : Number(product.stock);
    if (stock !== null && Number.isFinite(stock)) {
      if (stock <= 0) return fail(MESSAGES.soldOut, 409);
      if (qty > stock) return fail(MESSAGES.stock, 409);
    }
  }

  const subtotal = unitPrice * qty;

  // Same SECURITY DEFINER function the checkout page calls to preview a code,
  // so the discount shown and the discount charged cannot disagree.
  let discount = 0;
  let couponCode: string | null = null;
  const requested = String(body.coupon_code ?? "").trim();
  if (requested) {
    const { data: verdict, error: couponError } = await db.rpc("validate_coupon", {
      p_code: requested,
      p_subtotal: subtotal,
      p_kind: kind,
    });

    /* A broken lookup is not the same as a bad code. Treating it as "no
       discount" would silently charge the full price to someone who was just
       shown a discounted total — so stop instead. */
    if (couponError) {
      console.error("bkash-payment: coupon validation failed.", couponError.message);
      return fail(MESSAGES.coupon, 502);
    }

    if (verdict && verdict.valid) {
      discount = Math.max(0, Math.min(Number(verdict.discount_bdt) || 0, subtotal));
      couponCode = String(verdict.code);
    }
    // A genuinely invalid code is dropped rather than rejected: the customer
    // already saw why when they pressed "প্রয়োগ", and the total they are about
    // to be charged is the undiscounted one shown on the page.
  }

  const total = Math.max(0, subtotal - discount);
  const buyer = body.buyer ?? {};

  // Unique per attempt and short enough for bKash's invoice field. The order's
  // own uuid is not used: it would tell anyone reading a transaction record
  // how to address the row directly.
  const invoice = `SHD${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 4096).toString(36).toUpperCase()}`;

  const { data: order, error: orderError } = await db
    .from("orders")
    .insert({
      user_id: userId,
      kind,
      item_id: itemId,
      item_title: title,
      qty,
      subtotal_bdt: subtotal,
      discount_bdt: discount,
      coupon_code: couponCode,
      amount_bdt: total,
      payment_method: total === 0 ? "free" : "bKash",
      // A ৳0 order has nothing to take to a gateway, so it is done on the spot.
      status: total === 0 ? "completed" : "pending",
      paid_at: total === 0 ? new Date().toISOString() : null,
      bkash_invoice: invoice,
      buyer_name: buyer.name?.trim() || null,
      buyer_phone: buyer.phone?.trim() || null,
      buyer_email: buyer.email?.trim() || null,
      shipping_address: buyer.address?.trim() || null,
    })
    .select("id")
    .single();

  if (orderError || !order) {
    console.error("bkash-payment: could not write the order.", orderError?.message);
    return fail(MESSAGES.gateway, 500);
  }

  if (total === 0) {
    if (kind === "course") await grantCourse(db, userId, itemId);
    return json({ free: true, orderId: order.id });
  }

  try {
    const cfg = readConfig(db);
    const payment = await createPayment(cfg, {
      amount: total,
      invoice,
      /* No query string on this URL. bKash builds the success/failure/cancel
         URLs by appending "?paymentID=...&status=...", so a callbackURL that
         already had a "?" in it would come back with two, and everything after
         the first would be swallowed into one parameter. The order is found by
         its payment id instead, which is the authoritative key anyway. */
      callbackURL: `${Deno.env.get("SUPABASE_URL")}/functions/v1/bkash-callback`,
      payerReference: payerReference(buyer.phone, invoice),
    });

    await db
      .from("orders")
      .update({ bkash_payment_id: payment.paymentId, bkash_signature: payment.signature || null })
      .eq("id", order.id);

    return json({ bkashURL: payment.bkashURL, orderId: order.id });
  } catch (err) {
    const message = err instanceof BkashError ? err.message : MESSAGES.gateway;
    console.error("bkash-payment: create failed.", err instanceof Error ? err.message : String(err));
    await db
      .from("orders")
      .update({ status: "failed", failure_reason: message })
      .eq("id", order.id);
    return fail(message, 502);
  }
}

/* ---------- status ----------------------------------------------------
   The customer's browser is not a reliable messenger: they can close the tab
   on bKash's page, lose signal on the way back, or land on the callback after
   it has already run. payment-status.html calls this on load.

   ON QUERY PAYMENT
   bKash allow Query Payment only as a fallback for an Execute that gave no
   answer, never as a step in the normal flow. That is exactly its scope here:
   it runs only for an order still marked `pending`, and an order is only ever
   pending because no Execute response was obtained for it — either Execute
   timed out (the callback says so in the log) or the customer never came back
   through the callback at all, so Execute was never reached.

   The moment Execute does answer, the callback writes `completed` or
   `failed`, and the branch below stops running for that order. A payment that
   goes through normally is therefore never queried. */

async function handleStatus(db: SupabaseClient, userId: string, body: Body): Promise<Response> {
  const orderId = String(body.orderId ?? "").trim();
  if (!orderId) return fail(MESSAGES.notFound, 404);

  const { data: order } = await db
    .from("orders")
    .select("id, user_id, kind, item_id, item_title, amount_bdt, status, bkash_trx_id, bkash_payment_id, failure_reason")
    .eq("id", orderId)
    .maybeSingle();

  // Someone else's order id is simply "not found" — never a hint that it exists.
  if (!order || order.user_id !== userId) return fail(MESSAGES.notFound, 404);

  if (order.status === "pending" && order.bkash_payment_id) {
    try {
      const result = await queryPayment(readConfig(db), order.bkash_payment_id);
      if (result.transactionStatus === "Completed") {
        await settleOrder(db, order, result.trxId, result.payerAccount);
        order.status = "completed";
        order.bkash_trx_id = result.trxId;
      } else if (result.transactionStatus && result.transactionStatus !== "Initiated") {
        /* Anything final that is not "Completed" — Cancelled, Failed. bKash's
           own wording is kept so the page can show it rather than ours. */
        const reason = result.message || `bKash returned status ${result.transactionStatus}.`;
        await db.from("orders").update({ status: "failed", failure_reason: reason }).eq("id", order.id);
        order.status = "failed";
        order.failure_reason = reason;
      }
    } catch (err) {
      // Leave it pending rather than guessing; the next load asks again.
      console.error("bkash-payment: status lookup failed.", err instanceof Error ? err.message : String(err));
    }
  }

  // So a failed payment can offer "try again" on the same item rather than
  // dumping the customer back at the top of the catalogue.
  const table = order.kind === "course" ? "courses" : "products";
  const { data: item } = await db.from(table).select("slug").eq("id", order.item_id).maybeSingle();

  return json({
    order: {
      id: order.id,
      kind: order.kind,
      slug: item?.slug ?? null,
      title: order.item_title,
      amount: order.amount_bdt,
      status: order.status,
      trxId: order.bkash_trx_id,
      reason: order.failure_reason,
    },
  });
}

/* ---------- refund ---------------------------------------------------- */

async function handleRefund(db: SupabaseClient, userId: string, body: Body): Promise<Response> {
  if (!(await isAdmin(db, userId))) return fail("Not allowed.", 403);

  const orderId = String(body.orderId ?? "").trim();
  const { data: order } = await db
    .from("orders")
    .select("id, amount_bdt, refunded_bdt, status, bkash_payment_id, bkash_trx_id, item_title")
    .eq("id", orderId)
    .maybeSingle();

  if (!order) return fail("Order not found.", 404);
  if (order.status !== "completed" || !order.bkash_payment_id || !order.bkash_trx_id) {
    return fail("Only a completed bKash payment can be refunded.", 409);
  }

  const alreadyRefunded = Number(order.refunded_bdt) || 0;
  const remaining = Number(order.amount_bdt) - alreadyRefunded;
  const amount = Math.floor(Number(body.amount) || 0);
  if (amount <= 0 || amount > remaining) {
    return fail(`Refund must be between 1 and ${remaining} BDT.`, 400);
  }

  try {
    /* Same stored id_token as every other call — the token store in
       schema.sql section 29 is shared, so a refund never grants its own. */
    const result = await refundPayment(readConfig(db), {
      paymentId: order.bkash_payment_id,
      trxId: order.bkash_trx_id,
      amount,
      reason: String(body.reason ?? "").trim() || "Merchant refund",
      sku: String(body.sku ?? "").trim() || order.item_title.slice(0, 40),
    });

    const refundedTotal = alreadyRefunded + amount;
    await db.from("order_refunds").insert({
      order_id: order.id,
      refund_trx_id: result.refundTrxId || null,
      amount_bdt: amount,
      reason: String(body.reason ?? "").trim() || null,
      sku: String(body.sku ?? "").trim() || null,
      status: result.status || "Completed",
      created_by: userId,
    });

    await db
      .from("orders")
      .update({
        refunded_bdt: refundedTotal,
        // A partial refund leaves the order completed — the buyer still keeps
        // what they bought. Only a full one reverses it.
        status: refundedTotal >= Number(order.amount_bdt) ? "refunded" : "completed",
      })
      .eq("id", order.id);

    return json({ refundTrxId: result.refundTrxId, refunded: refundedTotal });
  } catch (err) {
    const message = err instanceof BkashError ? err.message : "The refund could not be completed.";
    console.error("bkash-payment: refund failed.", err instanceof Error ? err.message : String(err));
    return fail(message, 502);
  }
}

/* ---------- entry point ------------------------------------------------ */

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail("Method not allowed.", 405);

  const db = admin();
  const userId = await callerId(db, req);
  if (!userId) return fail(MESSAGES.auth, 401);

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return fail("Malformed request.", 400);
  }

  switch (body.action) {
    case "create":
      return await handleCreate(db, userId, body);
    case "status":
      return await handleStatus(db, userId, body);
    case "refund":
      return await handleRefund(db, userId, body);
    default:
      return fail("Unknown action.", 400);
  }
});
