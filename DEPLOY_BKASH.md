# Deploying bKash checkout

The site takes money now. A student buys a course or a product, pays on bKash's
own page, and their access switches on by itself — no more Google Form and no
more granting enrolments by hand.

Two Edge Functions do the work:

| Function | What it is for |
|---|---|
| `bkash-payment` | Prices the order, starts the payment, checks a payment's status, issues refunds |
| `bkash-callback` | Where bKash returns the customer. Executes the payment server-to-server and settles the order |

Until both are deployed and the secrets are set, **every checkout fails** with
"পেমেন্ট শুরু করা যায়নি".

Do all of this once. It takes about fifteen minutes.

---

## What you need first

| Thing | Where to get it |
|---|---|
| Supabase CLI | `npm i -g supabase`, or see supabase.com/docs/guides/cli |
| Your project ref | Supabase dashboard → Settings → General |
| bKash merchant credentials | The credential sheet bKash sends you: app key, app secret, username, password |
| Your live site URL | e.g. `https://shahedin.com` — where customers come back to |

bKash gives you a **sandbox** set of credentials first. Use those until the
whole flow works, then repeat step 3 with the live set.

> **Never put these in a file in this repo.** The credentials sheet
> (`bkash PGW Documentation (v2).txt`) is in `.gitignore` for that reason.
> Keep it, but keep it out of git.

---

## 1. Run the database migration

Supabase dashboard → **SQL Editor** → paste **sections 28 and 29** of
`schema.sql` (`28. bKash PAYMENT GATEWAY` and `29. bKash TOKEN STORE`) and run
them. Running the whole file is also fine — every statement in it is safe to
re-run.

**Section 29 is not optional.** It holds the one shared `id_token`, which is
what keeps the integration inside bKash's limit of one Grant Token call per
hour. Without it every function instance would ask for its own token and the
merchant account gets blocked for an hour. See *bKash's integration checklist*
below.

Section 28 does four things, and the last one matters most:

- adds the payment columns to `orders` (`bkash_payment_id`, `bkash_trx_id`,
  `paid_at`, `refunded_bdt`, …) and the `order_refunds` table;
- moves coupon counting from "order created" to "order paid", so an abandoned
  checkout no longer burns a use of a limited code;
- **removes the browser's ability to write `orders` rows.** They were insertable
  from the page with any amount and `status: 'completed'` — which, since a
  completed product order is what unlocks a digital download, was a free
  download for anyone who opened devtools;
- **stops students self-enrolling in paid courses.** The old policy checked only
  that you were enrolling *yourself*, not that you had paid. One REST call got
  you into any course. Free courses still self-enrol; paid ones now come from
  the Edge Function after bKash confirms the money.

Skip this step and checkout will fail on the very first order — the columns it
writes do not exist yet.

## 2. Link the CLI to your project

```bash
supabase login
supabase link --project-ref <project-ref>
```

## 3. Set the secrets

Run from the repo root, with **single quotes** — the password contains
characters (`<`, `*`) that some shells will otherwise interpret.

```bash
# Sandbox while testing:  https://tokenized.sandbox.bka.sh/v2
# Live once approved:     https://tokenized.pay.bka.sh/v2
supabase secrets set BKASH_BASE_URL='https://tokenized.sandbox.bka.sh/v2'

supabase secrets set BKASH_APP_KEY='your_app_key'
supabase secrets set BKASH_APP_SECRET='your_app_secret'
supabase secrets set BKASH_USERNAME='your_merchant_username'
supabase secrets set BKASH_PASSWORD='your_merchant_password'

# No trailing slash. The callback appends /payment-status.html to this.
supabase secrets set SITE_URL='https://your-site.com'
```

Check they landed (this prints names and digests, never values):

```bash
supabase secrets list
```

## 4. Deploy both functions

```bash
supabase functions deploy bkash-payment
supabase functions deploy bkash-callback --no-verify-jwt
```

`--no-verify-jwt` on the callback is **required and is not optional**. bKash
returns the customer as an ordinary browser redirect with no Supabase session
attached, so with JWT verification on every payment would 401 on its way home
and no order would ever be settled. Nothing is trusted because it arrived at
that URL: the money is confirmed by a server-to-server Execute Payment call.

(`supabase/config.toml` already sets `verify_jwt = false` for it, so a whole
project deploy applies the flag for you. The explicit flag is for deploying
this one function on its own.)

## 5. Tell bKash where the callback lives

If your bKash onboarding asks for a callback or redirect URL, give them:

```
https://<project-ref>.supabase.co/functions/v1/bkash-callback
```

Not your website URL. The customer's final stop is your site, but bKash talks
to the function.

## 6. Test it end to end

With sandbox credentials, buy something on the site. On bKash's page use one of
their test wallets, OTP `123456`, PIN `12121` (bKash confirms the current test
values on your credentials sheet).

What should happen:

1. Checkout sends you to `sandbox.payment.bkash.com`.
2. You enter wallet number → OTP → PIN.
3. You land back on `payment-status.html` with **পেমেন্ট সফল হয়েছে** and a
   transaction id.
4. The course shows in your dashboard, or the digital product's download
   appears there.
5. Admin → Orders shows the order as **Paid** with the bKash trx id on the row.

Then test the unhappy paths, because they are the ones that go wrong quietly:

- **Cancel on the bKash page.** Order should read *Cancelled*, no access
  granted, and the site should offer to try again.
- **Close the tab on the bKash page after paying.** Open
  `payment-status.html?order=<the order id>` from Admin → Orders. It should ask
  bKash directly, find the payment, and settle the order.

Watch what happened:

```bash
supabase functions logs bkash-payment
supabase functions logs bkash-callback
```

## 7. Go live

Re-run **only** the base URL secret with the production host, then redeploy
(secrets reach a function on its *next* deploy):

```bash
supabase secrets set BKASH_BASE_URL='https://tokenized.pay.bka.sh/v2'
supabase secrets set BKASH_APP_KEY='live_app_key'
supabase secrets set BKASH_APP_SECRET='live_app_secret'
supabase secrets set BKASH_USERNAME='live_username'
supabase secrets set BKASH_PASSWORD='live_password'
supabase functions deploy bkash-payment
supabase functions deploy bkash-callback --no-verify-jwt
```

Then buy one real thing for the smallest price you sell, confirm it arrives in
the merchant wallet, and refund it from Admin → Orders. That last part tests
the refund path while the amount is still trivial.

---

## bKash's integration checklist

bKash reviews the call sequence during UAT. Each of their requirements, and
where it is met — worth re-reading before you edit any of this code, because
several of the rules look like arbitrary detail until you know they are graded.

**Grant Token is called once an hour and the token is shared.** The `id_token`
lives in the `bkash_token` table (schema.sql section 29), not in the function's
memory. Supabase creates and destroys function instances on demand and
`bkash-payment` and `bkash-callback` are separate deployments, so an in-memory
cache would grant a token per cold start. `bkash_token_claim()` hands the right
to refresh to exactly one caller at a time — everyone else waits and reuses
what it stored. One token serves every customer for the hour.

*Refresh Token is never called.* Granting once an hour stays inside the same
budget without the two-calls-then-blocked risk that a retry loop around
Refresh would carry.

**Failure and cancel go to the failure page.** `bkash-callback` maps
`status=failure` and `status=cancel` from the Create callback straight to
`payment-status.html`, which shows the reason and offers to try again.

**Execute is called only on `status=success`.** Nothing else in the code path
calls it.

**Only `transactionStatus = "Completed"` is a paid order.** Any other Execute
outcome marks the order failed and shows bKash's own `errorMessageEn`, which
is stored verbatim on the order and rendered on the failure page. Their
message is never rewritten.

**Query Payment is only ever a fallback for Execute.** It runs in exactly two
places, both of which mean "Execute produced no answer":

- in `bkash-callback`, when Execute times out, drops the connection, or
  returns a body that cannot be parsed;
- in `bkash-payment`'s `status` action, for an order still marked `pending` —
  which only happens when no Execute response was ever obtained, either
  because it timed out or because the customer closed the tab and the callback
  never ran at all.

The moment Execute answers, the order becomes `completed` or `failed` and is
never queried again. A payment that completes normally is never queried. Note
in particular that a duplicate callback (bKash code `2117`, "already
executed") does **not** trigger a Query — the outcome is already in our own
row, so it is read from there.

**Refunds use the same stored token.** The Refund API goes through the same
`bkash_token` store as every other call; it never grants a token of its own.

---

## Giving bKash the call log

bKash ask for the request and response of every API call made during test
payments, so they can confirm the integration calls the right endpoints in the
right order. Every call is recorded automatically — Grant Token, Create
Payment, Execute Payment, Query Payment and Refund, successes and failures
alike, with timings and bKash's own response codes.

After the test payments are done, export it:

```powershell
.\tools\export-bkash-log.ps1
```

Two files land on your Desktop — a readable `.txt` (one block per call) and a
`.json` of the same rows. Send those to bKash.

```powershell
.\tools\export-bkash-log.ps1 -SinceHours 6    # just this afternoon's testing
```

**The files are safe to email.** `app_secret`, the merchant password,
`id_token`, `refresh_token` and the `Authorization` header are replaced with
`[redacted]` *before the row is written*, so no secret is ever in the database
to leak in the first place. `app_key` and `username` are kept on purpose —
bKash need them to identify which merchant and application the log belongs to,
and neither is usable without the secret and password that are stripped.

The log lives in the `bkash_api_log` table (schema.sql section 30), readable
only by admins. It grows by roughly two rows per payment, so it needs no
routine pruning; clear it between test rounds with
`delete from bkash_api_log;` if you want a clean file for a specific session.

---

## Refunds

Admin → Orders → **Refund** on any paid bKash order. It asks for an amount
(defaulting to everything still refundable) and a reason, then sends the money
back through bKash immediately.

bKash's limits, which the function enforces:

- up to **10 partial refunds** against one transaction;
- never more than what is left of the original amount;
- within **60 days** of the payment.

A partial refund leaves the order **Paid** — the buyer keeps what they bought.
Refunding the last taka flips it to **Refunded**, which also hands back the
coupon use if one was applied.

---

## If a payment does not work

The functions log the reason on every failure. They never log the app secret,
the password, or the token.

| What you see | What it means | Fix |
|---|---|---|
| "bKash is not configured: missing …" | A secret is unset | `supabase secrets list`, set it, **redeploy** — secrets only reach a function on the next deploy |
| Grant Token rejected / account blocked for an hour | Grant was called too often | Check section 29 actually ran: `select * from bkash_token;` should have exactly one row. If the table is missing, every payment grants its own token |
| "Timed out waiting for a bKash access token" | An instance died holding the refresh lease | Self-healing — the lease expires after 60s. If it persists, `update bkash_token set locked_until = null where id = 1;` |
| `2049` Invalid Merchant Callback URL | bKash does not recognise the callback | Step 5. The URL must be the function's, and reachable over HTTPS |
| `2006` / `2007` Invalid amount or currency | An order for ৳0 reached the gateway | Should not happen — free orders complete without bKash. Check the item's price in the admin panel |
| `2023` Insufficient Balance | The customer's wallet is short | Nothing to fix; they see the message |
| `2029` Duplicate for all transactions | An invoice number was reused | Should not happen — each attempt generates a fresh one |
| `2117` The payment execution has already been completed | A duplicate callback | Handled automatically: the function reads the real result back with Query Payment |
| Customer stuck on "পেমেন্ট যাচাই করা হচ্ছে" | bKash has not settled it yet | The page keeps asking for ~20s, then invites them to reload. The order stays *pending* deliberately — marking it failed would strand a real payment |
| Everything 401s | `bkash-callback` was deployed with JWT verification on | Redeploy it with `--no-verify-jwt` |

**A payment that took money but shows as pending** will settle itself the next
time anyone opens `payment-status.html?order=<id>` for it — that page asks bKash
rather than trusting the redirect. There is no state a customer can leave the
gateway in that permanently loses their money.

---

## Local testing

```bash
cp supabase/functions/.env.example supabase/functions/.env
# fill in the bKash values in that file
supabase start
supabase functions serve --env-file supabase/functions/.env
```

bKash cannot reach `localhost`, so the callback will not fire against a local
function — the redirect from bKash simply fails to load. Test the create step
locally and the full round trip against a deployed function.

`supabase/functions/.env` must never be committed. The repo's `.gitignore`
already covers `.env`; leave that rule in place.

---

## What is stored where

| Value | Lives in | In git? |
|---|---|---|
| `id_token` (runtime) | `bkash_token` table, RLS on with no policies | No |
| `BKASH_BASE_URL` | Supabase secrets | No |
| `BKASH_APP_KEY` | Supabase secrets | No |
| `BKASH_APP_SECRET` | Supabase secrets | No |
| `BKASH_USERNAME` | Supabase secrets | No |
| `BKASH_PASSWORD` | Supabase secrets | No |
| `SITE_URL` | Supabase secrets | No |
| Function source | `supabase/functions/bkash-*` and `_shared/` | Yes |
| Function config | `supabase/config.toml` | Yes |
| Tables and policies | `schema.sql`, sections 28 and 29 | Yes |

No credential appears in any tracked file. Nothing bKash-related is sent to the
browser except the one-time payment URL the customer is redirected to — wallet
number, OTP and PIN are entered on bKash's own page and never touch this site.

---

## Deliberately not built

So nobody goes looking for these:

- **Saved wallets ("tokenized with agreement").** The bKash spec also covers
  agreements, which let a returning customer pay with just their PIN. Nothing
  here is a subscription and every purchase is a separate item, so the
  without-agreement flow is what is wired up. The agreement endpoints are not
  called.
- **Stock is not decremented on sale.** Checkout refuses to sell an item the
  admin has marked as out of stock, and will not sell more than the stock left,
  but the number itself is still yours to maintain in Admin → Products —
  exactly as it was before payments existed.
