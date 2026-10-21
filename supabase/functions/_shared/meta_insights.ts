/* =========================================================================
   Facebook ad results, turned into the handful of numbers the admin panel
   shows. Kept apart from the network calls so it can be tested on its own.
   -------------------------------------------------------------------------
   Facebook reports most results as a list of { action_type, value } pairs,
   and the same purchase can appear under several names depending on where
   it was counted. One name is picked per result, in a fixed order, so a sale
   is never added up twice.
   ========================================================================= */

export interface ActionRow {
  action_type: string;
  value: string;
}

export interface InsightRow {
  spend?: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  inline_link_clicks?: string;
  actions?: ActionRow[];
  action_values?: ActionRow[];
  campaign_id?: string;
  campaign_name?: string;
}

export interface Summary {
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  linkClicks: number;
  purchases: number;
  purchaseValue: number;
  checkouts: number;
  registrations: number;
  leads: number;
  costPerPurchase: number | null;
  roas: number | null;
}

// Most specific first. "omni_" is Facebook's de-duplicated total across
// website, app and offline; the pixel-specific names are the fallback.
const PURCHASE = ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase"];
const CHECKOUT = ["omni_initiated_checkout", "initiate_checkout", "offsite_conversion.fb_pixel_initiate_checkout"];
const REGISTRATION = ["omni_complete_registration", "complete_registration", "offsite_conversion.fb_pixel_complete_registration"];
const LEAD = ["lead", "offsite_conversion.fb_pixel_lead", "onsite_conversion.lead_grouped"];

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/* The first of `names` that Facebook reported, so one sale counts once. */
export function pick(rows: ActionRow[] | undefined, names: string[]): number {
  if (!Array.isArray(rows)) return 0;
  for (const name of names) {
    const hit = rows.find((r) => r.action_type === name);
    if (hit) return num(hit.value);
  }
  return 0;
}

export function summarise(row: InsightRow | undefined | null): Summary {
  const r = row ?? {};
  const spend = num(r.spend);
  const purchases = pick(r.actions, PURCHASE);
  const purchaseValue = pick(r.action_values, PURCHASE);
  return {
    spend,
    impressions: num(r.impressions),
    reach: num(r.reach),
    clicks: num(r.clicks),
    linkClicks: num(r.inline_link_clicks),
    purchases,
    purchaseValue,
    checkouts: pick(r.actions, CHECKOUT),
    registrations: pick(r.actions, REGISTRATION),
    leads: pick(r.actions, LEAD),
    // null rather than 0 or Infinity: "no sales yet" is not "free sales".
    costPerPurchase: purchases > 0 ? spend / purchases : null,
    roas: spend > 0 && purchaseValue > 0 ? purchaseValue / spend : null,
  };
}

export const PERIODS: Record<string, string> = {
  today: "today",
  last_7d: "last_7d",
  last_30d: "last_30d",
  this_month: "this_month",
  maximum: "maximum",
};

/* The same period as a Dhaka-time date range, for counting the website's own
   paid orders over the same days Facebook is reporting on. Dhaka is UTC+6
   with no daylight saving. "maximum" has no start. */
export function periodRange(period: string, now = new Date()): { from: Date | null; to: Date } {
  const DHAKA_MS = 6 * 3600 * 1000;
  const local = new Date(now.getTime() + DHAKA_MS);
  const startOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - DHAKA_MS);
  const todayStart = startOfDay(local);
  switch (period) {
    case "today":
      return { from: todayStart, to: now };
    case "last_7d":
      // Facebook's last_7d is the 7 full days before today.
      return { from: new Date(todayStart.getTime() - 7 * 86400000), to: todayStart };
    case "last_30d":
      return { from: new Date(todayStart.getTime() - 30 * 86400000), to: todayStart };
    case "this_month":
      return { from: new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - DHAKA_MS), to: now };
    default:
      return { from: null, to: now };
  }
}
