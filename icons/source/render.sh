#!/bin/sh
# Render icon.html to a PNG with headless Chrome.
# Usage: icons/source/render.sh "<query>" <size> <out.png>
#   e.g. icons/source/render.sh "v=ruby" 512 icons/icon-512.png
set -e
DIR=$(cd "$(dirname "$0")" && pwd)
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PROFILE=$(mktemp -d)
"$CHROME" --headless=new --disable-gpu --hide-scrollbars --default-background-color=00000000 \
  --virtual-time-budget=4000 --force-device-scale-factor=1 --window-size="$2,$2" \
  --user-data-dir="$PROFILE" --screenshot="$3" "file://$DIR/icon.html?$1" >/dev/null 2>&1
rm -rf "$PROFILE"
