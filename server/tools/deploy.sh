#!/usr/bin/env bash
# Copies the API to the Stellar server and checks every PHP file there.
#
#   bash server/tools/deploy.sh
#
# server/app    -> ~/shahedin-app        (code, not reachable from the web)
# server/public -> ~/api.shahedin.com    (index.php and .htaccess only)
# The settings file ~/shahedin-private/config.php is never touched.
set -euo pipefail
cd "$(dirname "$0")/../.."
KEY="$HOME/.ssh/shahedin_stellar"
HOST="shahgoln@server186.web-hosting.com"
SSH=(ssh -i "$KEY" -p 21098 -o BatchMode=yes "$HOST")

tar -czf - -C server app public sql | "${SSH[@]}" '
  set -e
  rm -rf ~/.deploy && mkdir -p ~/.deploy && tar -xzf - -C ~/.deploy
  for f in ~/.deploy/app/*.php ~/.deploy/public/*.php; do php -l "$f" >/dev/null || { echo "syntax error in $f"; php -l "$f"; exit 1; }; done
  mkdir -p ~/shahedin-app ~/api.shahedin.com/media
  cp -f ~/.deploy/app/*.php ~/shahedin-app/
  cp -f ~/.deploy/public/index.php ~/.deploy/public/.htaccess ~/api.shahedin.com/
  cp -f ~/.deploy/public/media/.htaccess ~/api.shahedin.com/media/.htaccess
  cp -f ~/.deploy/sql/*.sql ~/shahedin-private/
  rm -rf ~/.deploy
  echo "deployed: $(ls ~/shahedin-app | tr "\n" " ")"
' 2>&1 | grep -v "post-quantum\|store now\|upgraded\|pq.html"
