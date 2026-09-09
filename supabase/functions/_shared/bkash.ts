/* =========================================================================
   bKash PGW Tokenized Checkout v2 — API client
   -------------------------------------------------------------------------
   Every call this site makes to bKash goes through this file. It is shared by
   the two Edge Functions:

     bkash-payment   creates a payment, checks its status, issues refunds
     bkash-callback  executes the payment when the customer comes back

   Credentials live in environment variables and never leave the server. The
   browser is never given anything it could replay: it receives a bkashURL to
   redirect to, and nothing else.

   Reference: "PGW Tokenized Payment V2 (Non-Beta) — API Specification v1.2".
   ========================================================================= */

import { SupabaseClient } from "npm:@supabase/supabase-js@2";

export interface BkashConfig {
  baseUrl: string;
  appKey: string;
  appSecret: string;
  username: string;
  password: string;
  /* Service-role client, used only to reach the shared token store in
     `bkash_token`. Every bKash call needs it, so it rides along with the
     credentials rather than being threaded through each function. */
  db: SupabaseClient;
}

/* bKash answers a rejected call in more than one shape depending on which
   layer refused it — the auth endpoints use externalCode/errorMessageEn, the
   payment endpoints have historically also used statusCode/statusMessage, and
   a gateway-level failure is a plain non-2xx with no JSON at all. `code` is
   normalised across all three so callers can branch on it (2117 "already
   executed" is the one that actually matters), and `message` is always the
   text bKash wrote.

   The spec is explicit that the message is the part to show a customer:
   "Merchants should display error or success messages based on the message
   parameter, not the error code." */
export class BkashError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = "BkashError";
    this.code = code;
    this.status = status;
  }
}

const SUCCESS_CODE = "0000";

// The spec asks for a 30-second timeout on every call. Without this a hung
// bKash connection would hold the Edge Function open until the platform kills
// it, and the customer would sit on a spinner with no answer either way.
const TIMEOUT_MS = 30_000;

export function readConfig(db: SupabaseClient): BkashConfig {
  const baseUrl = Deno.env.get("BKASH_BASE_URL");
  const appKey = Deno.env.get("BKASH_APP_KEY");
  const appSecret = Deno.env.get("BKASH_APP_SECRET");
  const username = Deno.env.get("BKASH_USERNAME");
  const password = Deno.env.get("BKASH_PASSWORD");

  const missing = [
    !baseUrl && "BKASH_BASE_URL",
    !appKey && "BKASH_APP_KEY",
    !appSecret && "BKASH_APP_SECRET",
    !username && "BKASH_USERNAME",
    !password && "BKASH_PASSWORD",
  ].filter(Boolean);

  if (missing.length) {
    // Names only. The values are never logged anywhere in this file.
    throw new Error(`bKash is not configured: missing ${missing.join(", ")}`);
  }

  return {
    // Trailing slashes vary between how the sandbox and production URLs are
    // written down in the spec; normalise once so path joining is predictable.
    baseUrl: baseUrl!.replace(/\/+$/, ""),
    appKey: appKey!,
    appSecret: appSecret!,
    username: username!,
    password: password!,
    db,
  };
}

/* ---------- Call log ----------------------------------------------------
   bKash ask for the request and response of every API call made during test
   payments, as evidence that the integration calls the right endpoints in the
   right order. They go to the bkash_api_log table (schema.sql section 30) and
   are exported with tools/export-bkash-log.ps1.

   REDACTED FIRST. The log exists to be handed to bKash, so it must never
   carry anything that would let the holder transact as this merchant. These
   keys are replaced before the row is written, not filtered on the way out —
   the secret is never in the database at all.

   app_key and username survive deliberately: bKash need them to identify
   which merchant and application the log belongs to, and neither is usable
   without the secret and password that do not survive. */
const SECRET_KEYS = new Set([
  "app_secret",
  "password",
  "id_token",
  "refresh_token",
  "authorization",
]);

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEYS.has(k.toLowerCase()) ? "[redacted]" : redact(v);
    }
    return out;
  }
  return value;
}

interface LogEntry {
  api: string;
  url: string;
  httpStatus: number | null;
  responseCode: string | null;
  errorMessage: string | null;
  durationMs: number;
  requestBody: unknown;
  responseBody: unknown;
}

async function writeLog(cfg: BkashConfig, entry: LogEntry): Promise<void> {
  try {
    const req = redact(entry.requestBody) as Record<string, unknown> | null;
    const res = redact(entry.responseBody) as Record<string, unknown> | null;

    await cfg.db.from("bkash_api_log").insert({
      api: entry.api,
      url: entry.url,
      http_status: entry.httpStatus,
      response_code: entry.responseCode,
      error_message: entry.errorMessage,
      duration_ms: entry.durationMs,
      // Pulled out of whichever side carries it, so a reviewer can follow one
      // payment across create -> execute -> query.
      payment_id: pickPaymentId(entry.requestBody) ?? pickPaymentId(entry.responseBody),
      request_body: req,
      response_body: res,
    });
  } catch (err) {
    /* A failed log write must never fail a payment. The customer's money is
       the point; the audit row is not worth losing a transaction over. */
    console.error("bkash: could not write the API log.", err instanceof Error ? err.message : String(err));
  }
}

function pickPaymentId(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const id = b.paymentID ?? b.paymentId;
  return typeof id === "string" && id ? id : null;
}

async function postJson(
  cfg: BkashConfig,
  api: string,
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const startedAt = Date.now();

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    const timedOut = err instanceof DOMException && err.name === "AbortError";
    const message = timedOut ? "bKash did not respond in time." : "Could not reach bKash.";
    // A call that never got an answer is still evidence — it is the exact
    // situation in which Query Payment is allowed as a fallback.
    await writeLog(cfg, {
      api,
      url,
      httpStatus: null,
      responseCode: timedOut ? "timeout" : "network",
      errorMessage: message,
      durationMs: Date.now() - startedAt,
      requestBody: body,
      responseBody: null,
    });
    throw new BkashError(message, timedOut ? "timeout" : "network", 504);
  } finally {
    clearTimeout(timer);
  }

  const raw = await response.text();
  const durationMs = Date.now() - startedAt;

  let parsed: Record<string, unknown>;
  try {
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    await writeLog(cfg, {
      api,
      url,
      httpStatus: response.status,
      responseCode: "malformed",
      errorMessage: "Response was not valid JSON.",
      durationMs,
      requestBody: body,
      // Kept verbatim (truncated) — an unparseable body is the one case where
      // the raw text is the only useful evidence.
      responseBody: { raw: raw.slice(0, 2000) },
    });
    throw new BkashError("bKash returned a response that could not be read.", "malformed", 502);
  }

  const code = String(
    parsed.errorCode ?? parsed.externalCode ?? parsed.statusCode ?? (response.ok ? SUCCESS_CODE : String(response.status)),
  );
  const failed = !response.ok || (code && code !== SUCCESS_CODE);
  const message = failed
    ? String(parsed.errorMessageEn ?? parsed.errorMessage ?? parsed.statusMessage ?? "bKash refused the request.")
    : null;

  // Logged before the throw, so failures are in the file too — those are the
  // ones bKash most want to see.
  await writeLog(cfg, {
    api,
    url,
    httpStatus: response.status,
    responseCode: code,
    errorMessage: message,
    durationMs,
    requestBody: body,
    responseBody: parsed,
  });

  if (failed) {
    throw new BkashError(message!, code, response.status);
  }

  return parsed;
}

/* ---------- Token ------------------------------------------------------
   bKash's integration review requires the Grant Token API to be called ONCE
   per hour, with the id_token stored and reused for that hour by every
   request and every customer. Going over gets the merchant blocked for an
   hour, so this is a hard limit, not a performance tuning knob.

   That rules out caching in module scope: Supabase creates and discards
   function isolates on demand, and bkash-payment and bkash-callback are
   separate deployments, so a per-instance cache would grant a token per cold
   start — many an hour under real traffic. The single row in `bkash_token`
   (schema.sql section 29) is the shared cache, and bkash_token_claim() hands
   the right to refresh to exactly one caller at a time.

   Refresh Token is deliberately never called. The spec caps it at two calls
   per hour and blocks the account on the third — an outage our own retry
   logic could trigger. Granting once an hour stays inside the same budget
   without that risk.

   The in-memory copy below is only a shortcut past a database round trip
   within one isolate. It can never outlive the expiry the database issued,
   so it cannot serve a token the shared store considers dead. */
interface CachedToken {
  value: string;
  expiresAt: number;
}

let memo: CachedToken | null = null;

// Ask for a new token a few minutes before the hour is up, so a request that
// starts just before expiry is never issued a token that dies mid-flight.
const EXPIRY_MARGIN_SECONDS = 180;

// How long to wait for whichever instance holds the refresh lease.
const LEASE_WAIT_MS = 1500;
const LEASE_ATTEMPTS = 4;

async function grantToken(cfg: BkashConfig): Promise<CachedToken> {
  const body = await postJson(
    cfg,
    "grant-token",
    `${cfg.baseUrl}/tokenized-checkout/auth/grant-token`,
    { username: cfg.username, password: cfg.password },
    { app_key: cfg.appKey, app_secret: cfg.appSecret },
  );

  const value = body.id_token;
  if (typeof value !== "string" || !value) {
    throw new BkashError("bKash did not return an access token.", "no_token", 502);
  }

  const lifetime = Number(body.expires_in) || 3600;
  return { value, expiresAt: Date.now() + Math.max(60, lifetime - EXPIRY_MARGIN_SECONDS) * 1000 };
}

async function token(cfg: BkashConfig): Promise<string> {
  if (memo && memo.expiresAt > Date.now()) return memo.value;

  for (let attempt = 0; attempt < LEASE_ATTEMPTS; attempt++) {
    const { data, error } = await cfg.db.rpc("bkash_token_claim");
    if (error) {
      throw new BkashError("Could not read the stored bKash token.", "token_store", 500);
    }

    if (data?.token) {
      // Someone else already granted it — reuse, which is the whole point.
      memo = { value: String(data.token), expiresAt: Date.parse(String(data.expires_at)) };
      return memo.value;
    }

    if (data?.refresh) {
      const granted = await grantToken(cfg);
      await cfg.db.rpc("bkash_token_store", {
        p_token: granted.value,
        p_expires_at: new Date(granted.expiresAt).toISOString(),
      });
      memo = granted;
      return granted.value;
    }

    // Another instance is mid-grant. Wait for it rather than calling bKash too.
    await new Promise((resolve) => setTimeout(resolve, LEASE_WAIT_MS));
  }

  throw new BkashError("Timed out waiting for a bKash access token.", "token_busy", 503);
}

async function authed(
  cfg: BkashConfig,
  api: string,
  path: string,
  body: unknown,
): Promise<Record<string, unknown>> {
  const idToken = await token(cfg);
  // The spec's samples send the raw id_token — NOT "Bearer <token>". Prefixing
  // it is rejected as an invalid credential.
  return await postJson(cfg, api, `${cfg.baseUrl}${path}`, { Authorization: idToken, "X-App-Key": cfg.appKey }, body);
}

/* ---------- Payment (Tokenized Without Agreement) ----------------------
   The customer enters wallet number, OTP and PIN on bKash's own page, so no
   wallet credential ever touches this site. */

export interface CreatePaymentInput {
  amount: number;
  invoice: string;
  callbackURL: string;
  // Shown on the bKash page and carried through to the transaction record.
  payerReference: string;
}

export interface CreatedPayment {
  paymentId: string;
  bkashURL: string;
  signature: string;
}

export async function createPayment(cfg: BkashConfig, input: CreatePaymentInput): Promise<CreatedPayment> {
  /* No `mode` field. v1 of this API took one on a single shared endpoint;
     v2 gives each mode its own path (/payment/create here, /agreement/create
     and /payment-with-agreement/create for the tokenized flows), so the mode
     is implied by the URL and sending it anyway risks a 2063 rejection. */
  const body = await authed(cfg, "create-payment", "/tokenized-checkout/payment/create", {
    payerReference: input.payerReference,
    callbackURL: input.callbackURL,
    amount: input.amount.toFixed(2),
    currency: "BDT",
    intent: "sale",
    merchantInvoiceNumber: input.invoice,
  });

  // The response table calls it bKashURL and the sample response calls it
  // bkashURL. Read whichever this deployment actually sends.
  const url = (body.bkashURL ?? body.bKashURL) as string | undefined;
  const paymentId = body.paymentID ?? body.paymentId;

  if (typeof url !== "string" || typeof paymentId !== "string") {
    throw new BkashError("bKash did not return a payment URL.", "no_payment_url", 502);
  }

  return { paymentId, bkashURL: url, signature: String(body.signature ?? "") };
}

export interface PaymentResult {
  paymentId: string;
  trxId: string;
  transactionStatus: string;
  amount: number;
  payerAccount: string;
  merchantInvoiceNumber: string;
  /* Any message that came back alongside a non-error HTTP response. bKash
     asks that the customer be shown their wording rather than ours whenever
     they provided some. Usually empty on a clean success. */
  message: string;
}

function toPaymentResult(body: Record<string, unknown>): PaymentResult {
  return {
    paymentId: String(body.paymentID ?? body.paymentId ?? ""),
    trxId: String(body.trxId ?? ""),
    transactionStatus: String(body.transactionStatus ?? ""),
    amount: Number(body.amount ?? 0),
    payerAccount: String(body.payerAccount ?? ""),
    merchantInvoiceNumber: String(body.merchantInvoiceNumber ?? body.merchantInvoice ?? ""),
    message: String(body.errorMessageEn ?? body.statusMessage ?? ""),
  };
}

/* Codes this client invents when bKash did not actually answer — a timeout, a
   dropped connection, or a body that could not be parsed. bKash's integration
   rules allow Query Payment as a fallback in exactly this situation and no
   other, so the callback branches on this set rather than on "something threw". */
export const NO_RESPONSE_CODES = new Set(["timeout", "network", "malformed"]);

export async function executePayment(cfg: BkashConfig, paymentId: string): Promise<PaymentResult> {
  return toPaymentResult(await authed(cfg, "execute-payment", "/tokenized-checkout/payment/execute", { paymentId }));
}

/* The spec's answer to "Execute returned nothing": ask what actually happened
   rather than assuming either way. Also the only safe way to handle a replayed
   callback, where execute reports 2117 (already executed) and the transaction
   id can only be recovered from here. */
export async function queryPayment(cfg: BkashConfig, paymentId: string): Promise<PaymentResult> {
  return toPaymentResult(await authed(cfg, "query-payment", "/tokenized-checkout/query/payment", { paymentId }));
}

/* ---------- Refunds ----------------------------------------------------
   Up to 10 partial refunds per transaction, within 60 days, capped at the
   original amount. */

export interface RefundInput {
  paymentId: string;
  trxId: string;
  amount: number;
  reason: string;
  sku: string;
}

export interface RefundResult {
  refundTrxId: string;
  originalTrxId: string;
  refundAmount: number;
  status: string;
}

export async function refundPayment(cfg: BkashConfig, input: RefundInput): Promise<RefundResult> {
  const body = await authed(cfg, "refund", "/tokenized-checkout/refund/payment/transaction", {
    paymentId: input.paymentId,
    trxId: input.trxId,
    refundAmount: input.amount.toFixed(2),
    reason: input.reason,
    sku: input.sku,
  });

  return {
    refundTrxId: String(body.refundTrxId ?? ""),
    originalTrxId: String(body.originalTrxId ?? input.trxId),
    refundAmount: Number(body.refundAmount ?? input.amount),
    status: String(body.refundTransactionStatus ?? ""),
  };
}
