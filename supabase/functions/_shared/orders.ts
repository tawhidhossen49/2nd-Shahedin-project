/* =========================================================================
   Settling an order — shared by bkash-payment and bkash-callback.
   -------------------------------------------------------------------------
   Both functions can be the one that learns a payment succeeded: normally the
   callback does, when the customer comes back from bKash; but if they closed
   that tab, the status check on payment-status.html gets there first. Either
   way the same thing has to happen exactly once, so it lives here rather than
   being written twice and drifting apart.
   ========================================================================= */

import { SupabaseClient } from "npm:@supabase/supabase-js@2";

export interface SettleableOrder {
  id: string;
  user_id: string;
  kind: string;
  item_id: string;
  amount_bdt: number;
}

/* Enrolment is what actually gives a student their course — the order row on
   its own opens nothing. Upserted so a replayed callback cannot fail here. */
export async function grantCourse(db: SupabaseClient, userId: string, courseId: string): Promise<void> {
  const { error } = await db
    .from("enrollments")
    .upsert({ user_id: userId, course_id: courseId }, { onConflict: "user_id,course_id" });
  if (error) {
    // Loud, because the customer has paid and is now missing what they bought.
    console.error(`bkash: payment taken but enrolment failed for order owner ${userId}.`, error.message);
  }
}

/* Marks an order paid and hands over what was bought.

   Idempotent by construction: the `.neq("status", "completed")` filter means a
   second call updates no rows, and an empty result is the signal to stop
   before granting access again. That matters because bKash can hit the
   callback more than once for one payment (a refreshed tab is enough), and
   because the status poller may race the callback. */
export async function settleOrder(
  db: SupabaseClient,
  order: SettleableOrder,
  trxId: string,
  payerAccount: string,
): Promise<boolean> {
  const { data: updated, error } = await db
    .from("orders")
    .update({
      status: "completed",
      bkash_trx_id: trxId || null,
      bkash_payer_account: payerAccount || null,
      paid_at: new Date().toISOString(),
      failure_reason: null,
    })
    .eq("id", order.id)
    .neq("status", "completed")
    .select("id");

  if (error) {
    console.error("bkash: could not mark the order paid.", error.message);
    return false;
  }
  if (!updated || updated.length === 0) return false;

  if (order.kind === "course") await grantCourse(db, order.user_id, order.item_id);
  return true;
}
