/* =========================================================================
   Meta (Facebook) Conversions API — the server half of the Meta Pixel
   -------------------------------------------------------------------------
   The browser Pixel (js/meta-pixel.js) reports page views, course views and
   checkouts. Purchases are reported from HERE as well, because the buyer pays
   on bKash's own page and an ad blocker or a closed tab can stop the browser
   from ever telling Meta about the sale. The server always knows: it is what
   marks the order paid.

   The browser sends the same Purchase with the same event id
   ("order_<order id>"), and Meta keeps one of the two, so a sale reported by
   both is counted once.

   WHERE THE SETTINGS LIVE
     Pixel ID + on/off   site_settings row "meta_pixel", edited in
                         Admin -> Facebook ads. Public, like the Pixel ID
                         always is: it sits in every page's source anyway.
     Access token        the META_CAPI_TOKEN function secret. Never in the
                         database, never in a browser.

   NOTHING HERE MAY BREAK A PAYMENT. Every call is wrapped, time-limited and
   run after the order is already settled; a Meta outage costs one missing
   report, never an order or an enrolment.
   ========================================================================= */

import { SupabaseClient } from "npm:@supabase/supabase-js@2";

export const GRAPH = "https://graph.facebook.com/v25.0";
const TIMEOUT_MS = 6000;

export interface MetaSettings {
  enabled: boolean;
  pixelId: string;
  token: string;
  // The ad account whose results Admin -> Facebook ads shows. Digits only.
  adAccountId: string;
}

export interface RequestContext {
  ip?: string;
  ua?: string;
}

/* The customer's IP and browser, which Meta uses to match the event to a
   Facebook user. Both are sent as they are -- Meta's rules say these two are
   never hashed. */
export function requestContext(req: Request): RequestContext {
  const forwarded = req.headers.get("x-forwarded-for") ?? "";
  const ip = forwarded.split(",")[0].trim() || req.headers.get("x-real-ip") || "";
  return { ip: ip || undefined, ua: req.headers.get("user-agent") || undefined };
}

export async function readMetaSettings(db: SupabaseClient): Promise<MetaSettings> {
  const token = (Deno.env.get("META_CAPI_TOKEN") ?? "").trim();
  const { data } = await db.from("site_settings").select("value").eq("key", "meta_pixel").maybeSingle();
  const value = (data?.value ?? {}) as { enabled?: boolean; pixel_id?: string; ad_account_id?: string };
  const pixelId = String(value.pixel_id ?? "").trim();
  const adAccountId = String(value.ad_account_id ?? "").replace(/^act_/, "").trim();
  return {
    enabled: value.enabled === true && /^\d{6,20}$/.test(pixelId),
    pixelId,
    token,
    adAccountId: /^\d{5,25}$/.test(adAccountId) ? adAccountId : "",
  };
}

async function sha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* Meta's phone rule: digits only, no leading zeros, country code included.
   A Bangladeshi number typed as 01XXXXXXXXX becomes 8801XXXXXXXXX. */
export function normalisePhone(raw: string | null | undefined): string {
  let digits = String(raw ?? "").replace(/\D/g, "").replace(/^0+/, "");
  if (/^1\d{9}$/.test(digits)) digits = "880" + digits;
  return digits.length >= 8 ? digits : "";
}

export function normaliseEmail(raw: string | null | undefined): string {
  const email = String(raw ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

export interface MetaEvent {
  event_name: string;
  event_id: string;
  event_time?: number;
  event_source_url?: string;
  email?: string | null;
  phone?: string | null;
  external_id?: string | null;
  ctx?: RequestContext;
  custom_data?: Record<string, unknown>;
}

export interface SendResult {
  ok: boolean;
  skipped?: string;
  status?: number;
  body?: unknown;
}

/* One event to Meta. Returns what happened instead of throwing, so callers on
   the payment path can ignore failures safely. */
export async function sendMetaEvent(
  settings: MetaSettings,
  event: MetaEvent,
  testEventCode?: string,
): Promise<SendResult> {
  if (!settings.enabled) return { ok: false, skipped: "tracking is switched off" };
  if (!settings.token) return { ok: false, skipped: "no access token on the server" };

  const user_data: Record<string, unknown> = {};
  const email = normaliseEmail(event.email);
  const phone = normalisePhone(event.phone);
  if (email) user_data.em = [await sha256(email)];
  if (phone) user_data.ph = [await sha256(phone)];
  if (event.external_id) user_data.external_id = [await sha256(String(event.external_id))];
  if (event.ctx?.ip) user_data.client_ip_address = event.ctx.ip;
  if (event.ctx?.ua) user_data.client_user_agent = event.ctx.ua;

  const payload: Record<string, unknown> = {
    data: [{
      event_name: event.event_name,
      event_time: event.event_time ?? Math.floor(Date.now() / 1000),
      event_id: event.event_id,
      action_source: "website",
      event_source_url: event.event_source_url,
      user_data,
      custom_data: event.custom_data ?? {},
    }],
  };
  if (testEventCode) payload.test_event_code = testEventCode;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(
      `${GRAPH}/${encodeURIComponent(settings.pixelId)}/events?access_token=${encodeURIComponent(settings.token)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      },
    );
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      // Meta's own message, never the token: it is only in the URL above.
      const message = (body as { error?: { message?: string } } | null)?.error?.message ?? `HTTP ${res.status}`;
      console.error(`meta: ${event.event_name} ${event.event_id} was refused: ${message}`);
    }
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    console.error(`meta: ${event.event_name} ${event.event_id} could not be sent:`, err instanceof Error ? err.message : String(err));
    return { ok: false, skipped: "network error or timeout" };
  } finally {
    clearTimeout(timer);
  }
}

/* The Purchase event for a paid order, read fresh from the database.

   Only real money is reported: an order paid in the bKash sandbox, a free
   order, or one with no amount is skipped, so test payments never show up as
   sales in Ads Manager. */
export async function buildPurchase(db: SupabaseClient, orderId: string, ctx?: RequestContext): Promise<MetaEvent | null> {
  const { data: order } = await db
    .from("orders")
    .select("id, user_id, kind, item_id, item_title, qty, amount_bdt, buyer_email, buyer_phone, bkash_env, paid_at, status")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return null;
  if (order.bkash_env !== "live") return null;
  if (!(Number(order.amount_bdt) > 0)) return null;

  const site = (Deno.env.get("SITE_URL") ?? "").replace(/\/+$/, "");
  return {
    event_name: "Purchase",
    event_id: `order_${order.id}`,
    event_time: order.paid_at ? Math.floor(new Date(order.paid_at).getTime() / 1000) : undefined,
    event_source_url: site ? `${site}/payment-status.html` : undefined,
    email: order.buyer_email,
    phone: order.buyer_phone,
    external_id: order.user_id,
    ctx,
    custom_data: {
      currency: "BDT",
      value: Number(order.amount_bdt),
      content_ids: [String(order.item_id)],
      content_type: "product",
      content_name: order.item_title,
      content_category: order.kind,
      num_items: Number(order.qty) || 1,
      order_id: String(order.id),
    },
  };
}

/* Called by settleOrder once an order has just been marked paid. Hands the
   work to the runtime to finish after the response has gone back, so the
   customer is never kept waiting for Meta, and swallows every error. */
export function queuePurchaseReport(db: SupabaseClient, orderId: string, ctx?: RequestContext): void {
  const work = (async () => {
    try {
      const settings = await readMetaSettings(db);
      if (!settings.enabled || !settings.token) return;
      const event = await buildPurchase(db, orderId, ctx);
      if (event) await sendMetaEvent(settings, event);
    } catch (err) {
      console.error("meta: purchase report failed.", err instanceof Error ? err.message : String(err));
    }
  })();

  const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (runtime && typeof runtime.waitUntil === "function") {
    runtime.waitUntil(work);
  }
  // Without EdgeRuntime the promise still runs; it already catches its own errors.
}
