# Deploying the BulkSMSBD SMS hook

Students log in with a phone number and an SMS OTP. Supabase has no built-in
BulkSMSBD provider, so until this hook is deployed **no OTP is ever sent and
nobody can log in**.

This routes every OTP Supabase generates through BulkSMSBD instead. Nothing on
the website changes: `js/auth.js` keeps calling `signInWithOtp()` exactly as it
does now.

Do all of this once. It takes about ten minutes.

---

## What you need first

| Thing | Where to get it |
|---|---|
| Supabase CLI | `npm i -g supabase`, or see supabase.com/docs/guides/cli |
| Your project ref | Supabase dashboard → Settings → General. It is also the first part of your project URL. |
| BulkSMSBD API key | bulksmsbd.net → log in → API key |
| BulkSMSBD sender ID | The approved sender/masking name on your account |

> **Sender ID note.** If yours is a *masking* ID, BulkSMSBD rejects English-only
> messages with code `1012` ("Masking SMS must be sent in Bengali"). The OTP
> message in `supabase/functions/send-sms/index.ts` is deliberately bilingual,
> so it works with either kind.

---

## 1. Turn on Phone auth

Dashboard → **Authentication → Providers → Phone** → enable it.

Leave the built-in SMS provider fields empty. The hook replaces them.

## 2. Create the Send SMS Hook and copy its secret

Dashboard → **Authentication → Hooks** → **Send SMS Hook**.

- Type: **HTTPS**
- URL: `https://<project-ref>.supabase.co/functions/v1/send-sms`
- Enable it.

Supabase generates a signing secret that looks like `v1,whsec_...`.
**Copy it now** — you need it in step 4, and it is only shown once.

## 3. Link the CLI to your project

```bash
supabase login
supabase link --project-ref <project-ref>
```

## 4. Set the three secrets

Run from the repo root. Substitute your own values; do not put them in any file.

```bash
supabase secrets set SEND_SMS_HOOK_SECRETS='v1,whsec_paste_the_secret_from_step_2'
supabase secrets set BULKSMSBD_API_KEY='your_bulksmsbd_api_key'
supabase secrets set BULKSMSBD_SENDER_ID='your_sender_id'
```

Use **single quotes**. The secret contains a comma, and some shells will mangle
it unquoted.

Check they landed (this prints names and digests, not values):

```bash
supabase secrets list
```

## 5. Deploy the function

```bash
supabase functions deploy send-sms --no-verify-jwt
```

`--no-verify-jwt` is required and is not optional. Supabase calls this hook
**before** the user is authenticated, so there is no JWT to check. With JWT
verification on, every call is rejected with 401 and no OTP is ever sent. The
request is authenticated instead by its webhook signature, which the function
verifies against `SEND_SMS_HOOK_SECRETS`.

(`supabase/config.toml` already sets `verify_jwt = false`, so if you deploy the
whole project with `supabase deploy` the flag is applied for you. The explicit
flag above is for deploying this one function on its own.)

## 6. Test it

Open the site, go to the dashboard, and sign up with a real Bangladeshi number.
You should get the SMS within a few seconds.

Watch what happened:

```bash
supabase functions logs send-sms
```

---

## If the SMS does not arrive

The function logs BulkSMSBD's raw reply on every failure, so the response code
tells you exactly what is wrong. It never logs the OTP or your API key.

| Code | Meaning | Fix |
|---|---|---|
| `202` | Accepted | Working. If the SMS still did not arrive, it is on BulkSMSBD's side. |
| `1001` | Invalid number | The number reached them in the wrong format. Should not happen — the function converts `+8801…` to `8801…` itself. |
| `1002` | Sender ID wrong or disabled | Check `BULKSMSBD_SENDER_ID` matches an approved ID exactly. |
| `1003` | Required fields missing | Usually a missing or wrong API key. |
| `1007` | Insufficient balance | Top up. |
| `1012` | Masking SMS must be in Bengali | Your sender ID is a masking ID. The bundled message already contains Bengali, so this means the message was edited. |
| `1013`–`1016` | Sender ID not routed to a gateway for this API key | BulkSMSBD support has to link them. |

Other things worth checking:

**401 in the logs, no BulkSMSBD call at all.** The function was deployed with
JWT verification on, or `SEND_SMS_HOOK_SECRETS` does not match the secret
Supabase is signing with. Re-run step 4 with the secret from step 2, then
redeploy with `--no-verify-jwt`.

**"SMS provider is not configured" / 500.** One of the three secrets is unset.
`supabase secrets list` shows which. Secrets only reach the function on the
*next* deploy, so run step 5 again after setting them.

**Nothing in the logs at all.** Supabase never called the hook. Check the hook
is enabled in step 2 and that the URL has no typo.

---

## Local testing

```bash
cp supabase/functions/.env.example supabase/functions/.env
# fill in the three values in that file
supabase start
supabase functions serve send-sms --no-verify-jwt --env-file supabase/functions/.env
```

Then in `supabase/config.toml`, swap the deployed `uri` for the local one that
is commented directly beneath it.

`supabase/functions/.env` must never be committed. The repo's `.gitignore`
already covers `.env`; leave that rule in place.

---

## What is stored where

| Value | Lives in | In git? |
|---|---|---|
| `SEND_SMS_HOOK_SECRETS` | Supabase secrets | No |
| `BULKSMSBD_API_KEY` | Supabase secrets | No |
| `BULKSMSBD_SENDER_ID` | Supabase secrets | No |
| Function source | `supabase/functions/send-sms/index.ts` | Yes |
| Hook configuration | `supabase/config.toml` | Yes |

No credential appears in any tracked file. The function reads all three from
the environment and nothing else.
