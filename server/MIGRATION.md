# Moving shahedin.com from Supabase to the Stellar server

The website (HTML/JS on Vercel) stays where it is. Only the back end moves:
data, logins, payments and uploaded files go from Supabase to api.shahedin.com,
which runs on Namecheap Stellar hosting (PHP 8.2, MariaDB). The code is in `server/`.

## What lives where on the server

| Folder | What | Reachable from the web |
|---|---|---|
| `~/shahedin-app/` | the API code (`server/app`) | no |
| `~/api.shahedin.com/` | `index.php`, `.htaccess`, `media/` (uploads) | yes |
| `~/shahedin-private/` | `config.php` (all secrets), `db.php`, backups, tools | no (chmod 700) |

Secrets are only in `~/shahedin-private/config.php`: bKash, BulkSMSBD, Google,
Meta. `server/config.example.php` shows its shape. Never put it in git.

Deploy code changes with `bash server/tools/deploy.sh` (checks every PHP file first).

## Checks (run on the server, all must say "all passed")

```
php ~/shahedin-private/selftest.php    # data rules and logins (55 checks)
php ~/shahedin-private/paytest.php     # bKash, admin team, Facebook page (starts one unpaid bKash checkout)
php ~/shahedin-private/storetest.php   # uploads and the media folder
```

## Before the switch

- [ ] SSL certificate on api.shahedin.com (https works)
- [ ] Google login: redirect URI `https://api.shahedin.com/auth/google/callback` in Google Cloud, client id + secret in config.php
- [ ] Test site switched (steps 3-5 below against the vercel site) and tested: phone login, Google login, a course page, the admin panel, an upload, one or two small real bKash payments and one refund
- [ ] Meta tokens in config.php (optional; only the Facebook page and purchase reports need them)

## Switch day (about 30 minutes; do it late at night)

1. **Fresh copy of the data.** Export from Supabase and import (replaces everything on Stellar):
   `bash server/tools/export-supabase.sh export.json`, copy it to `~/shahedin-private/`, then
   `php import.php export.json` there. The import prints a count check.
2. **Files.** Re-list the Supabase storage files
   (`select name from storage.objects where bucket_id = 'media'`) into `media-list.txt` and run
   `php media-sync.php media-list.txt`. It copies only new files and moves every link.
3. **Point the website at Stellar.** `python server/tools/switch-site.py` (changes the script tag on
   every page, `js/supabase-config.js`, and the privacy text).
4. **Landing page for bKash.** In `config.php` set `'site_url' => 'https://www.shahedin.com'`.
5. **Run the three checks** above.
6. **Publish the website** (Ariyan deploys the new files to shahedin.com).
7. **Watch** the first real login and the first real order in the admin panel.

Everyone has to log in once more after the switch (old Supabase logins do not carry over).
Orders started on Supabase just before the switch still finish there: keep Supabase running.

## After the switch

- Keep Supabase running, untouched, for one month as the way back.
- Backups: nightly at 3 AM Dhaka (`backup.sh`, cron `0 16 * * *` server time), 14 days kept in
  `~/shahedin-private/backups/`. Failures email the address set in cPanel → Cron Jobs.
- The SMS balance (BulkSMSBD) must not run out, or nobody can log in by phone.
- The hosting plan must stay paid (auto-renew on).

## Going back (if something is badly wrong)

Revert the website commit from step 3 and redeploy. The site talks to Supabase again
at once. Anything done on Stellar in between (new orders, sign-ups) has to be copied back by hand.
