#!/usr/bin/env bash
# Reads every table from the Supabase database (read-only) into one JSON file,
# ready for server/tools/import.php on Stellar.
#
#   bash server/tools/export-supabase.sh <output.json>
#
# Needs the Supabase CLI linked to the project (npx supabase link). The file
# holds customer data and login hashes: keep it out of the repo and delete it
# once it has been imported.
set -euo pipefail
OUT="${1:?usage: export-supabase.sh <output.json>}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
# The CLI wants this set to parse supabase/config.toml; nothing is deployed with it.
export SEND_SMS_HOOK_SECRETS="${SEND_SMS_HOOK_SECRETS:-v1,whsec_ZHVtbXlfbG9jYWxfdmFsaWRhdGlvbl9vbmx5X25vdF9wdXNoZWQ=}"

TABLES="profiles admins courses products coupons enrollments course_reviews orders order_refunds bkash_api_log home_content site_settings contact_submissions page_views activity_log"

q() { # $1 = name, $2 = SQL returning one json column called "j"
  printf '%s' "$2" > "$TMP/$1.sql"
  npx --yes supabase db query --linked --read-only -f "$TMP/$1.sql" > "$TMP/$1.out" 2>/dev/null
}

# auth.users -> users. Google sign-ins keep Google's id so the same person
# lands in the same account after the move.
q users "select coalesce(json_agg(json_build_object(
  'id', u.id, 'phone', u.phone, 'email', u.email, 'password_hash', nullif(u.encrypted_password, ''),
  'google_sub', (select i.provider_id from auth.identities i where i.user_id = u.id and i.provider = 'google' limit 1),
  'user_metadata', coalesce(u.raw_user_meta_data, '{}'::jsonb),
  'phone_confirmed_at', u.phone_confirmed_at, 'email_confirmed_at', u.email_confirmed_at,
  'last_sign_in_at', u.last_sign_in_at, 'created_at', u.created_at, 'updated_at', u.updated_at)), '[]') as j
  from auth.users u"

for t in $TABLES; do
  q "$t" "select coalesce(json_agg(t), '[]') as j from public.$t t"
done

python - "$TMP" "$OUT" users $TABLES <<'PY'
import json, sys, os
tmp, out, names = sys.argv[1], sys.argv[2], sys.argv[3:]
data = {}
for n in names:
    raw = open(os.path.join(tmp, n + ".out"), encoding="utf-8").read()
    rows = json.loads(raw[raw.index("{"):])["rows"]
    data[n] = rows[0]["j"]
    print(f"{n}: {len(data[n])}")
json.dump(data, open(out, "w", encoding="utf-8"), ensure_ascii=False)
PY
