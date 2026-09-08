/* =========================================================================
   Shared HTTP helpers for the bKash Edge Functions.
   -------------------------------------------------------------------------
   The site is a static front end served from a different origin than the
   Supabase project, so every browser-facing function needs CORS. The wildcard
   is safe here: these functions are authorised by an Authorization header, not
   by a cookie, so a hostile page cannot make an authenticated call on a
   visitor's behalf just by having the origin allowed.
   ========================================================================= */

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/* One shape for every failure the browser can see: { error: "..." }.
   js/checkout.js shows `error` to the customer verbatim, which is what the
   bKash spec asks for — the gateway's own message, unedited. */
export function fail(message: string, status = 400): Response {
  return json({ error: message }, status);
}
