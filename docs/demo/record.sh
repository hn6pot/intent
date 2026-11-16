#!/bin/sh
# Draws docs/demo/intent.gif from the mock (docs/demo/demo.html): one screenshot per step, then a GIF.
# Needs Google Chrome and ffmpeg.
set -eu
cd "$(dirname "$0")"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
# How long each step stays on screen, in seconds (pane, press, story, chapter, ask, running, answer, files).
DURATIONS="2.5 1 3 2.5 1 1.5 5 3"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

i=0
for d in $DURATIONS; do
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
    --window-size=1040,640 --screenshot="$tmp/$i.png" "file://$PWD/demo.html#$i" 2>/dev/null
  printf "file '%s'\nduration %s\n" "$tmp/$i.png" "$d" >> "$tmp/list.txt"
  last=$i
  i=$((i + 1))
done
# The concat demuxer drops the last frame's duration unless that frame is listed again.
printf "file '%s'\n" "$tmp/$last.png" >> "$tmp/list.txt"

ffmpeg -loglevel error -y -f concat -safe 0 -i "$tmp/list.txt" \
  -vf "scale=1040:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=none" \
  -loop 0 intent.gif
echo "docs/demo/intent.gif written"
