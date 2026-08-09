/* =========================================================================
   Supabase "Send SMS Hook" -> BulkSMSBD
   -------------------------------------------------------------------------
   Supabase Auth has no built-in BulkSMSBD provider, so phone OTPs never send.
   This hook intercepts every OTP Supabase is about to deliver and posts it to
   BulkSMSBD instead. js/auth.js keeps calling supabase.auth.signInWithOtp()
   exactly as before; nothing on the front end changes.

   Supabase calls this with a POST signed per the Standard Webhooks spec:

     {
       "user": { "id": "...", "phone": "+8801XXXXXXXXX", ... },
       "sms":  { "otp": "123456" }
     }

   Contract with Supabase:
     · 200 + {}      -> Supabase treats the OTP as sent
     · non-2xx       -> Supabase surfaces the failure to the caller, and
                        js/auth.js shows the visitor a real error instead of
                        pretending a code is on its way.

   Secrets come from environment variables only. Nothing here is ever logged
   that could leak a credential or an OTP -- see the note above the failure
   log below.
   ========================================================================= */

/* The npm package is "standardwebhooks", one word -- the hyphenated
   "standard-webhooks" is the name of the specification, not the package, and
   resolves to nothing. Imported with the npm: specifier, which the Supabase
   Edge Runtime supports natively; no esm.sh round trip needed. */
import { Webhook } from "npm:standardwebhooks@1.0.0";

const BULKSMSBD_ENDPOINT = "https://bulksmsbd.net/api/smsapi";

// BulkSMSBD's "SMS Submitted Successfully". Every other code is a failure,
// and several of them are silent-looking (insufficient balance, disabled
// sender id), which is exactly why anything else is treated as an error.
const ACCEPTED = 202;

interface SendSmsPayload {
  user?: { phone?: string };
  sms?: { otp?: string };
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/* Supabase Auth reads this shape to report the reason back to the client,
   alongside the non-2xx status. */
function hookError(message: string, httpCode: number): Response {
  return json({ error: { http_code: httpCode, message } }, httpCode);
}

/* BulkSMSBD replies with JSON like {"response_code":202,...} but has been
   known to return a bare number or a plain-text line depending on the
   account and the error. Parse defensively rather than assuming JSON. */
function readResponseCode(raw: string): number | null {
  try {
    const parsed = JSON.parse(raw);
    const code = parsed?.response_code ?? parsed?.responseCode;
    if (code !== undefined && code !== null) return Number(code);
  } catch {
    // Not JSON. Fall through to the text form.
  }
  const match = raw.match(/\d{3,4}/);
  return match ? Number(match[0]) : null;
}

/* Kept short on purpose. Bangla is UCS-2, so an SMS containing any Bangla
   character is billed at 70 characters per segment rather than 160. This
   message is ~55, which stays inside one segment.

   The Bangla half is not decoration: BulkSMSBD rejects English-only content
   sent from a masking sender ID with code 1012 ("Masking SMS must be sent in
   Bengali"). A bilingual body works with both masked and non-masked IDs. */
function otpMessage(otp: string): string {
  return `Shahedin OTP: ${otp}\nকোডটি কারও সাথে শেয়ার করবেন না।`;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return hookError("Method not allowed.", 405);
  }

  const hookSecret = Deno.env.get("SEND_SMS_HOOK_SECRETS");
  const apiKey = Deno.env.get("BULKSMSBD_API_KEY");
  const senderId = Deno.env.get("BULKSMSBD_SENDER_ID");

  // Fail loudly at the first request rather than silently not sending. The
  // names are safe to log; the values are never touched.
  const missing = [
    !hookSecret && "SEND_SMS_HOOK_SECRETS",
    !apiKey && "BULKSMSBD_API_KEY",
    !senderId && "BULKSMSBD_SENDER_ID",
  ].filter(Boolean);
  if (missing.length) {
    console.error(`send-sms: missing environment variable(s): ${missing.join(", ")}`);
    return hookError("SMS provider is not configured.", 500);
  }

  // The body must be read as raw text: the signature covers the exact bytes
  // Supabase sent, so re-serialising a parsed object would break verification.
  const rawBody = await req.text();

  try {
    // Supabase stores the secret as "v1,whsec_<base64>"; the library wants
    // just the base64 half.
    const wh = new Webhook(hookSecret!.replace("v1,whsec_", ""));
    wh.verify(rawBody, Object.fromEntries(req.headers));
  } catch (err) {
    // An unsigned or replayed request must never be able to make us send an
    // SMS, which would otherwise be a free way to burn the SMS balance.
    console.error("send-sms: webhook signature verification failed.", String(err));
    return hookError("Invalid webhook signature.", 401);
  }

  let payload: SendSmsPayload;
  try {
    payload = JSON.parse(rawBody) as SendSmsPayload;
  } catch {
    return hookError("Malformed hook payload.", 400);
  }

  const phone = payload?.user?.phone?.trim();
  const otp = payload?.sms?.otp?.trim();
  if (!phone || !otp) {
    console.error("send-sms: payload was missing user.phone or sms.otp.");
    return hookError("Hook payload was missing the phone number or the code.", 400);
  }

  // Supabase hands over E.164 (+8801XXXXXXXXX). BulkSMSBD wants the same
  // digits with no leading plus: 8801XXXXXXXXX.
  const number = phone.replace(/^\+/, "");

  const form = new URLSearchParams({
    api_key: apiKey!,
    senderid: senderId!,
    number,
    message: otpMessage(otp),
  });

  let response: Response;
  try {
    response = await fetch(BULKSMSBD_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
  } catch (err) {
    console.error("send-sms: could not reach BulkSMSBD.", String(err));
    return hookError("Could not reach the SMS provider.", 502);
  }

  const rawResponse = await response.text();
  const code = readResponseCode(rawResponse);

  if (code !== ACCEPTED) {
    /* The raw provider response is logged because the response code is the
       only way to tell "insufficient balance" from "sender id disabled" from
       "invalid number", and all three look identical to the visitor.
       Safe to log: this is BulkSMSBD's reply, which contains no OTP and no
       API key. The OTP itself is never logged anywhere in this file. */
    console.error(
      `send-sms: BulkSMSBD rejected the message. HTTP ${response.status}, code ${code ?? "unknown"}, raw: ${rawResponse}`,
    );
    return hookError("The SMS provider did not accept the message.", 502);
  }

  return json({}, 200);
});
