/* =========================================================================
   meta-ads — what Admin -> Facebook ads asks the server
   -------------------------------------------------------------------------
   POST { action: "status" }
        Is tracking on, which Pixel, and is the server's access token valid?
        The token itself never leaves the server; only "valid / not valid".

   POST { action: "test", test_event_code }
        Sends one test event to Meta, marked with the code shown in Events
        Manager -> Test events, so the admin can watch it arrive. Test events
        appear only on that tab and are not counted as real visits or sales.

   POST { action: "results", period }
        The ad account's results for a period (today, last_7d, last_30d,
        this_month, maximum): spend, reach, clicks, sales from ads, cost per
        sale, return on ad spend, and the same per campaign -- plus the
        website's own paid orders over the same days, for comparison.

   TWO TOKENS, TWO JOBS
     META_CAPI_TOKEN      sends events (the Pixel's server half)
     META_ADS_READ_TOKEN  reads ad results; ads_read only, so it cannot
                          change an ad or spend money
   Neither ever leaves the server.

   WHO MAY CALL IT
   A signed-in main admin, or a limited admin given the "Facebook ads" page
   (schema.sql section 37). Checked here against `admins`; verify_jwt is the
   outer gate only, since the public anon key would also pass it.
   ========================================================================= */

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, fail, json } from "../_shared/http.ts";
import { buildPurchase, GRAPH, readMetaSettings, requestContext, sendMetaEvent } from "../_shared/meta.ts";
import { InsightRow, PERIODS, periodRange, summarise } from "../_shared/meta_insights.ts";

const readToken = () => (Deno.env.get("META_ADS_READ_TOKEN") ?? "").trim();

/* GET from the Graph API with the read token. Never throws: returns the body,
   or { error: { message } } -- so one failed call becomes a sentence on the
   page instead of a broken one. Time-limited, because the admin is waiting. */
async function graphGet(path: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const token = readToken();
  if (!token) return { error: { message: "no read token" } };
  const qs = new URLSearchParams({ ...params, access_token: token });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(`${GRAPH}/${path}?${qs.toString()}`, { signal: controller.signal });
    const body = await res.json().catch(() => null);
    return (body ?? { error: { message: `HTTP ${res.status}` } }) as Record<string, unknown>;
  } catch (err) {
    return { error: { message: err instanceof Error ? err.message : String(err) } };
  } finally {
    clearTimeout(timer);
  }
}

const graphError = (body: Record<string, unknown>): string | null =>
  ((body.error as { message?: string } | undefined)?.message) ?? null;

const INSIGHT_FIELDS = "spend,impressions,reach,clicks,inline_link_clicks,actions,action_values";

function serviceClient(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
}

async function callerId(db: SupabaseClient, req: Request): Promise<string | null> {
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return null;
  const { data, error } = await db.auth.getUser(jwt);
  if (error || !data.user) return null;
  return data.user.id;
}

/* Main admins always; a limited admin only with the "ads" page ticked. */
async function mayUseAds(db: SupabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await db.from("admins").select("role, permissions").eq("id", userId).maybeSingle();
  if (error) {
    // A database without the roles columns: any admin, as the panel was before.
    const { data: row } = await db.from("admins").select("id").eq("id", userId).maybeSingle();
    return !!row;
  }
  if (!data) return false;
  return data.role === "main" || (Array.isArray(data.permissions) && data.permissions.includes("ads"));
}

/* Asks Meta whether the token is still good, without sending any event. */
async function tokenCheck(token: string): Promise<{ valid: boolean; expires: string; message?: string }> {
  if (!token) return { valid: false, expires: "", message: "No access token is saved on the server." };
  try {
    const res = await fetch(`${GRAPH}/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(token)}`);
    const body = await res.json().catch(() => null) as { data?: { is_valid?: boolean; expires_at?: number; error?: { message?: string } }; error?: { message?: string } } | null;
    const data = body?.data;
    if (!data) return { valid: false, expires: "", message: body?.error?.message ?? "Facebook did not answer." };
    const expires = data.expires_at ? new Date(data.expires_at * 1000).toISOString() : "never";
    return { valid: data.is_valid === true, expires, message: data.is_valid ? undefined : data.error?.message ?? "Facebook says this token is no longer valid." };
  } catch (err) {
    return { valid: false, expires: "", message: err instanceof Error ? err.message : String(err) };
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail("Method not allowed.", 405);

  const db = serviceClient();
  const userId = await callerId(db, req);
  if (!userId) return fail("Please log in again.", 401);
  if (!(await mayUseAds(db, userId))) return fail("You do not have access to the Facebook ads page.", 403);

  let body: { action?: string; test_event_code?: string };
  try {
    body = await req.json();
  } catch {
    return fail("The request could not be read.", 400);
  }

  const settings = await readMetaSettings(db);

  if (body.action === "status") {
    const token = await tokenCheck(settings.token);
    // Can the read token see the ad account? Name and currency say which
    // account it is, so a wrong number is easy to spot on the page.
    let adAccount: Record<string, unknown> = { connected: false, reason: "no_account" };
    if (!readToken()) adAccount = { connected: false, reason: "no_token" };
    else if (settings.adAccountId) {
      const acc = await graphGet(`act_${settings.adAccountId}`, { fields: "name,currency,account_status" });
      const err = graphError(acc);
      adAccount = err
        ? { connected: false, reason: "error", message: err, id: settings.adAccountId }
        : { connected: true, id: settings.adAccountId, name: acc.name, currency: acc.currency, active: acc.account_status === 1 };
    }
    return json({ enabled: settings.enabled, pixelId: settings.pixelId, tokenSaved: !!settings.token, token, adAccount });
  }

  if (body.action === "results") {
    const period = PERIODS[String((body as { period?: string }).period ?? "")] ?? "last_7d";
    if (!readToken()) return json({ connected: false, reason: "no_token" });
    if (!settings.adAccountId) return json({ connected: false, reason: "no_account" });
    const act = `act_${settings.adAccountId}`;

    const [account, total, campaigns] = await Promise.all([
      graphGet(act, { fields: "name,currency,account_status" }),
      graphGet(`${act}/insights`, { date_preset: period, fields: INSIGHT_FIELDS }),
      graphGet(`${act}/insights`, {
        date_preset: period, level: "campaign", limit: "25",
        fields: `campaign_id,campaign_name,${INSIGHT_FIELDS}`,
        sort: "spend_descending",
      }),
    ]);
    const accountError = graphError(account);
    if (accountError) return json({ connected: false, reason: "error", message: accountError });
    const totalError = graphError(total);
    if (totalError) return json({ connected: true, account: { name: account.name, currency: account.currency }, error: totalError });

    const totalRow = ((total.data as InsightRow[] | undefined) ?? [])[0];
    const campaignRows = (campaigns.data as InsightRow[] | undefined) ?? [];

    /* The website's own paid orders over the same days -- every sale, from
       ads or not -- so the admin can set Facebook's count beside the real
       one. Live bKash orders only; test payments are not sales. */
    const range = periodRange(period);
    let site = { orders: 0, revenue: 0 };
    let q = db.from("orders").select("amount_bdt").eq("status", "completed").eq("bkash_env", "live").gt("amount_bdt", 0).lt("paid_at", range.to.toISOString());
    if (range.from) q = q.gte("paid_at", range.from.toISOString());
    const { data: paid } = await q;
    if (paid) site = { orders: paid.length, revenue: paid.reduce((s, o) => s + (Number(o.amount_bdt) || 0), 0) };

    return json({
      connected: true,
      period,
      account: { id: settings.adAccountId, name: account.name, currency: account.currency, active: account.account_status === 1 },
      total: summarise(totalRow),
      hasData: !!totalRow,
      campaigns: campaignRows.map((r) => ({ id: r.campaign_id, name: r.campaign_name, ...summarise(r) })),
      campaignsError: graphError(campaigns),
      site,
    });
  }

  if (body.action === "test") {
    const code = String(body.test_event_code ?? "").trim();
    // Without a code a "test" would land in the real data as a genuine visit.
    if (!/^TEST\w{2,}$/i.test(code)) return fail("Copy the test code from Events Manager → Test events. It starts with TEST.", 400);
    if (!settings.pixelId) return fail("Save a Pixel ID first.", 400);
    if (!settings.token) return fail("The server has no access token yet. Ask your developer.", 400);

    // The test goes out even while tracking is switched off, so the admin can
    // check the connection before turning it on.
    const live = { ...settings, enabled: true };
    const ctx = requestContext(req);
    const pageView = await sendMetaEvent(live, {
      event_name: "PageView",
      event_id: `test_${crypto.randomUUID()}`,
      event_source_url: (Deno.env.get("SITE_URL") ?? "").replace(/\/+$/, "") + "/",
      external_id: userId,
      ctx,
    }, code);

    /* A purchase too, built exactly as a real one is from the most recent
       paid order, so the admin sees the event that matters most. Sent with
       the test code, so it is never counted as a sale -- and with the
       ADMIN's identity in place of that buyer's email and phone, because a
       test has no business sending a customer's details anywhere. */
    let purchase: { ok: boolean; status?: number; body?: unknown } | null = null;
    const { data: lastPaid } = await db
      .from("orders")
      .select("id")
      .eq("status", "completed")
      .eq("bkash_env", "live")
      .gt("amount_bdt", 0)
      .order("paid_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastPaid) {
      const event = await buildPurchase(db, lastPaid.id, ctx);
      if (event) {
        purchase = await sendMetaEvent(live, {
          ...event,
          event_id: `test_${crypto.randomUUID()}`,
          email: null,
          phone: null,
          external_id: userId,
        }, code);
      }
    }

    const error = (r: { body?: unknown } | null) =>
      (r?.body as { error?: { message?: string } } | null)?.error?.message ?? undefined;
    return json({
      pageView: { ok: pageView.ok, error: error(pageView) ?? pageView.skipped },
      purchase: purchase ? { ok: purchase.ok, error: error(purchase) } : null,
    });
  }

  return fail("Unknown action.", 400);
});
