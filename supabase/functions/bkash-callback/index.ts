/* =========================================================================
   bkash-callback — where the customer lands on the way back from bKash
   -------------------------------------------------------------------------
   bKash sends the customer's browser here after they finish (or abandon) the
   payment, with the result in the query string:

     ?paymentID=TR00...&status=success|failure|cancel&signature=...

   "success" here means only that the wallet number, OTP and PIN checked out.
   The money has NOT moved yet. Execute Payment is what actually takes it, and
   that is a server-to-server call — which is the whole reason this runs as a
   function rather than as a page on the site.

   Nothing the browser sends is trusted as proof of payment: the status
   parameter merely decides whether it is worth calling Execute, and Execute's
   own answer is what settles the order.

   verify_jwt MUST be false for this function (see supabase/config.toml). The
   customer arrives as a plain browser redirect from bKash with no Supabase
   session attached — a JWT check would 401 every payment on the way home.
   ========================================================================= */

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  BkashError,
  executePayment,
  NO_RESPONSE_CODES,
  PaymentResult,
  queryPayment,
  readConfig,
} from "../_shared/bkash.ts";
import { settleOrder } from "../_shared/orders.ts";

// bKash's own code for "you already executed this payment". Not an error in
// any sense the customer cares about — it means a duplicate callback, and the
// real outcome has to be read back with Query Payment.
const ALREADY_EXECUTED = "2117";

function redirect(to: string): Response {
  return new Response(null, { status: 302, headers: { Location: to } });
}

/* Constant-time string comparison. A plain !== returns as soon as the first
   character differs, and the time that takes leaks how much of a guess was
   right. Over the internet that is a hard signal to read, but this endpoint
   is public and unauthenticated by necessity, so there is no reason to offer
   it at all. Length is not secret -- every signature bKash issues is the
   same length -- so an early length check gives nothing away. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* Where the customer ends up. Kept to a fixed set of outcomes so the landing
   page never has to interpret anything bKash sent. */
function landing(orderId: string | null, outcome: "success" | "failed" | "cancelled" | "unknown"): string {
  const site = (Deno.env.get("SITE_URL") ?? "").replace(/\/+$/, "");
  const params = new URLSearchParams({ status: outcome });
  if (orderId) params.set("order", orderId);
  return `${site}/payment-status.html?${params.toString()}`;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (!Deno.env.get("SITE_URL")) {
    // Without this there is nowhere to send the customer, and they would be
    // stranded on a blank function response holding a completed payment.
    console.error("bkash-callback: SITE_URL is not set; cannot return the customer to the site.");
    return new Response("Payment received, but this site is misconfigured. Please contact support.", { status: 500 });
  }

  const url = new URL(req.url);
  // The API bodies spell it paymentId; the callback query string spells it
  // paymentID. Both appear in the spec's own samples.
  const paymentId = url.searchParams.get("paymentID") ?? url.searchParams.get("paymentId");
  const status = (url.searchParams.get("status") ?? "").toLowerCase();
  const signature = url.searchParams.get("signature");

  if (!paymentId) return redirect(landing(null, "unknown"));

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  const { data: order } = await db
    .from("orders")
    .select("id, user_id, kind, item_id, amount_bdt, status, bkash_signature, bkash_env")
    .eq("bkash_payment_id", paymentId)
    .maybeSingle();

  if (!order) {
    console.error(`bkash-callback: no order matches payment ${paymentId}.`);
    return redirect(landing(null, "unknown"));
  }

  /* THE SIGNATURE IS REQUIRED, not merely compared when present.

     bKash hands a signature back at create time and echoes it on every
     callback URL it builds. This endpoint has to be public -- the customer
     arrives as a plain redirect with no session -- and a payment ID is not
     secret: it sits in the customer's address bar and in bKash's page URL.
     The check used to run only when a signature was supplied, so simply
     leaving the parameter off skipped it, and anyone holding a payment ID
     could mark that customer's pending order cancelled or failed.

     A missing or wrong signature changes nothing and is sent to "unknown",
     never "failed": if it was a genuine customer whose signature went
     astray, payment-status.html asks bKash directly and settles the order
     from the real answer. Nobody is told their money was lost on the
     strength of a URL. */
  if (order.bkash_signature && (!signature || !safeEqual(signature, order.bkash_signature))) {
    console.error(`bkash-callback: ${signature ? "wrong" : "missing"} signature on order ${order.id}; nothing changed.`);
    return redirect(landing(order.id, "unknown"));
  }

  /* An order paid in the sandbox can only be settled by the sandbox. Once the
     live credentials are in, a late sandbox callback must not send a sandbox
     payment ID to the production account. */
  const cfg = readConfig(db);
  if ((order.bkash_env ?? "sandbox") !== cfg.env) {
    console.error(`bkash-callback: order ${order.id} belongs to ${order.bkash_env ?? "sandbox"}, running ${cfg.env}; ignored.`);
    return redirect(landing(order.id, "unknown"));
  }

  /* Only the three outcomes bKash documents are acted on, and each one only
     ever moves an order OUT of pending — so a duplicate callback can never
     undo a payment that has already been settled.

     Anything else (a missing status, a value bKash adds later) deliberately
     falls through to "unknown" and leaves the order pending, because the one
     unrecoverable mistake here would be writing off a payment that actually
     went through. payment-status.html asks bKash directly and settles it. */
  if (status === "cancel") {
    await db.from("orders").update({ status: "cancelled" }).eq("id", order.id).eq("status", "pending");
    return redirect(landing(order.id, "cancelled"));
  }

  if (status === "failure") {
    await db
      .from("orders")
      .update({ status: "failed", failure_reason: "bKash reported the payment as failed." })
      .eq("id", order.id)
      .eq("status", "pending");
    return redirect(landing(order.id, "failed"));
  }

  if (status !== "success") {
    console.error(`bkash-callback: unrecognised status "${status}" on order ${order.id}; left pending.`);
    return redirect(landing(order.id, "unknown"));
  }

  let result: PaymentResult;

  try {
    result = await executePayment(cfg, paymentId);
  } catch (err) {
    if (!(err instanceof BkashError)) throw err;

    if (NO_RESPONSE_CODES.has(err.code)) {
      /* Execute did not answer at all — a timeout, a dropped connection, or a
         body that could not be read. This is the ONE situation in which bKash
         allows Query Payment to be used, and the only place this integration
         calls it from the payment path. The money may well have moved, so
         asking is the only honest way to find out. */
      console.error(`bkash-callback: execute gave no response for order ${order.id}; querying as fallback.`);
      try {
        result = await queryPayment(cfg, paymentId);
      } catch (queryErr) {
        /* Still no answer. Leave the order PENDING rather than failing it —
           writing off a payment that actually went through is the one
           unrecoverable mistake here. payment-status.html asks again. */
        console.error(
          `bkash-callback: query fallback also failed for order ${order.id}.`,
          queryErr instanceof Error ? queryErr.message : String(queryErr),
        );
        return redirect(landing(order.id, "unknown"));
      }
    } else if (err.code === ALREADY_EXECUTED) {
      /* A duplicate callback for a payment already executed — a refreshed tab
         is enough to cause it. The outcome is already in our own row, so
         there is nothing to ask bKash: report what we recorded the first
         time. If the row is somehow still pending, it is left that way for
         the status check to settle rather than queried from here, which keeps
         Query strictly to the no-response case above. */
      return redirect(landing(order.id, order.status === "completed" ? "success" : "unknown"));
    } else {
      /* bKash answered, and the answer was a refusal — wrong PIN, insufficient
         balance, expired session. That is a failed payment, and their wording
         is what the customer is shown (payment-status.html renders this text). */
      await db
        .from("orders")
        .update({ status: "failed", failure_reason: err.message })
        .eq("id", order.id)
        .eq("status", "pending");
      return redirect(landing(order.id, "failed"));
    }
  }

  /* Only "Completed" is a paid order. Anything else is a failure, shown with
     whatever message bKash supplied. */
  if (result.transactionStatus !== "Completed") {
    await db
      .from("orders")
      .update({
        status: "failed",
        failure_reason: result.message || `bKash returned status ${result.transactionStatus || "unknown"}.`,
      })
      .eq("id", order.id)
      .eq("status", "pending");
    return redirect(landing(order.id, "failed"));
  }

  /* bKash was told the amount at create time and the customer cannot change
     it, so a mismatch means something is wrong upstream. The money is taken
     either way — flag it rather than silently banking a wrong figure. */
  if (Math.round(result.amount) !== Math.round(Number(order.amount_bdt))) {
    console.error(
      `bkash-callback: order ${order.id} expected ${order.amount_bdt} BDT but bKash settled ${result.amount}.`,
    );
  }

  await settleOrder(db, order, result.trxId, result.payerAccount);
  return redirect(landing(order.id, "success"));
});
