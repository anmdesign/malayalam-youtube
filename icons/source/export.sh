#!/bin/sh
# Export every app icon (web app + Android wrapper) from icon.html.
# Usage: icons/source/export.sh [design]   (default: ruby)
set -e
DIR=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$DIR/../.." && pwd)
RES="$ROOT/twa/app/src/main/res"
V=${1:-ruby}
TMP=$(mktemp -d)

render() { "$DIR/render.sh" "v=$V&$1" 1024 "$TMP/$2.png"; }
resize() { sips -z "$2" "$2" "$TMP/$1.png" --out "$3" >/dev/null; }

render ""                         full
render "round=1"                  round
render "pad=0.8"                  maskable
render "layer=bg"                 bg
render "layer=fg&pad=0.7"         fg
render "layer=fg&pad=0.7&mono=1"  mono
render "layer=fg&mono=1"          notif

# Web app
resize full 512 "$ROOT/icons/icon-512.png"
resize full 192 "$ROOT/icons/icon-192.png"
resize maskable 512 "$ROOT/icons/icon-maskable-512.png"

# Android
resize full 512 "$ROOT/twa/store_icon.png"
mkdir -p "$RES/mipmap-anydpi-v26"
for d in mdpi:1 hdpi:1.5 xhdpi:2 xxhdpi:3 xxxhdpi:4; do
  name=${d%%:*}; scale=${d##*:}
  px() { python3 -c "print(int($1*$scale))"; }
  resize round  "$(px 48)"  "$RES/mipmap-$name/ic_launcher.png"
  resize bg     "$(px 108)" "$RES/mipmap-$name/ic_launcher_background.png"
  resize fg     "$(px 108)" "$RES/mipmap-$name/ic_launcher_foreground.png"
  resize mono   "$(px 108)" "$RES/mipmap-$name/ic_launcher_monochrome.png"
  resize round  "$(px 300)" "$RES/drawable-$name/splash.png"
  resize notif  "$(px 24)"  "$RES/drawable-$name/ic_notification_icon.png"
done
cat > "$RES/mipmap-anydpi-v26/ic_launcher.xml" <<'XML'
<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
    <monochrome android:drawable="@mipmap/ic_launcher_monochrome" />
</adaptive-icon>
XML

rm -rf "$TMP"
echo "Exported $V icons"
