/* =========================================================================
   admin-users — create a login for a new admin
   -------------------------------------------------------------------------
   POST { email, password, full_name, role, permissions }

   WHY THIS IS A FUNCTION AND NOT A DATABASE CALL
   Everything else on Admin -> Team & access (changing a role, ticking pages,
   removing someone) is a database function in schema.sql section 34. This
   one step cannot be: making a new email + password login needs the service
   role, and the service role key must never reach a browser.

   WHO MAY CALL IT
   A signed-in MAIN admin, checked here against the `admins` table. The
   platform's own JWT check (verify_jwt) only proves the request carried a
   valid project token, which the public anon key also satisfies.

   WHAT IT WILL NOT DO
   Touch an existing login. If the email already has an account the call
   stops with code "exists", and the panel adds that person through
   admin_add_existing() instead, which leaves their password alone. A main
   admin can therefore never use this to reset somebody else's password.
   ========================================================================= */

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, fail, json } from "../_shared/http.ts";

// Same list as admin_page_keys() in schema.sql and PAGES in admin-common.js.
const PAGE_KEYS = [
  "home", "portfolio", "courses", "reviews", "submissions", "students",
  "products", "orders", "coupons", "analytics", "community", "legal", "settings",
];

interface Body {
  email?: string;
  password?: string;
  full_name?: string;
  role?: string;
  permissions?: unknown;
}

function serviceClient(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
}

async function callerId(db: SupabaseClient, req: Request): Promise<string | null> {
  const header = req.headers.get("Authorization") ?? "";
  const jwt = header.replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return null;
  const { data, error } = await db.auth.getUser(jwt);
  if (error || !data.user) return null;
  return data.user.id;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail("Method not allowed.", 405);

  const db = serviceClient();

  const userId = await callerId(db, req);
  if (!userId) return fail("Please log in again.", 401);

  const { data: me } = await db.from("admins").select("role").eq("id", userId).maybeSingle();
  if (!me || me.role !== "main") return fail("Only a main admin can add an admin.", 403);

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return fail("The request could not be read.", 400);
  }

  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const fullName = String(body.full_name ?? "").trim();
  const role = String(body.role ?? "");
  const permissions = Array.isArray(body.permissions)
    ? [...new Set(body.permissions.map((p) => String(p)).filter((p) => PAGE_KEYS.includes(p)))]
    : [];

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail("Enter a valid email address.", 400);
  if (password.length < 8) return fail("The password must be at least 8 characters.", 400);
  if (role !== "main" && role !== "partial") return fail("Choose a role.", 400);

  const { data: created, error: createErr } = await db.auth.admin.createUser({
    email,
    password,
    // No confirmation email: the main admin is vouching for this address, and
    // the admin login has no "confirm your email" step to send them back to.
    email_confirm: true,
    user_metadata: fullName ? { full_name: fullName } : {},
  });

  if (createErr || !created?.user) {
    const message = createErr?.message ?? "";
    const exists = (createErr as { code?: string } | null)?.code === "email_exists" ||
      /already (been )?registered|already exists/i.test(message);
    if (exists) {
      return json({ error: "That email already has a login.", code: "exists" }, 409);
    }
    return fail(message || "The login could not be created.", 400);
  }

  const { data: row, error: insertErr } = await db
    .from("admins")
    .insert({ id: created.user.id, email, full_name: fullName || null, role, permissions })
    .select("id, email, full_name, role, permissions, created_at")
    .single();

  if (insertErr || !row) {
    // Never leave a login behind that is not an admin of anything: undo it,
    // so a second attempt starts from the same place as the first.
    await db.auth.admin.deleteUser(created.user.id);
    return fail("The admin could not be saved, so no login was created. Try again.", 500);
  }

  return json({ admin: row });
});
