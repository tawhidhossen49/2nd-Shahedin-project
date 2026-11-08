#!/usr/bin/env bash
# Nightly database backup on the Stellar server. Runs from cron:
#   0 16 * * * bash $HOME/shahedin-private/backup.sh   (server time is US Eastern: 16:00 = 3 AM Dhaka)
# Keeps the last 14 days in ~/shahedin-private/backups (not reachable from the web).
set -euo pipefail
umask 077
P="$HOME/shahedin-private"
OUT="$P/backups"
mkdir -p "$OUT"

# The password goes in a private options file, so it never shows in the process list.
CNF="$P/.backup.cnf"
php -r '$c = require getenv("HOME")."/shahedin-private/db.php";
  echo "[client]\nhost={$c["host"]}\nuser={$c["user"]}\npassword=\"".addcslashes($c["pass"], "\"\\\\")."\"\n";' > "$CNF"
NAME=$(php -r '$c = require getenv("HOME")."/shahedin-private/db.php"; echo $c["name"];')

FILE="$OUT/shahedin-$(date -u +%Y-%m-%d_%H%M).sql.gz"
mariadb-dump --defaults-extra-file="$CNF" --single-transaction --routines --triggers \
  --default-character-set=utf8mb4 "$NAME" | gzip -9 > "$FILE.part"
mv "$FILE.part" "$FILE"
rm -f "$CNF"

# A dump without its last line is broken; keep it but say so.
zcat "$FILE" | tail -1 | grep -q "Dump completed" || echo "backup looks incomplete: $FILE" >&2

find "$OUT" -name 'shahedin-*.sql.gz' -mtime +14 -delete

# Sundays: a password-locked copy goes to the owner's email, off this server.
# Only once mail-backup.php has been put on the server (the owner decides).
if [ "$(date +%u)" = 7 ] && [ -f "$P/mail-backup.php" ]; then php "$P/mail-backup.php" "$FILE" >/dev/null; fi
