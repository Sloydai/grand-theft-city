#!/bin/bash
# Grand Theft Oslo: starts a small web server on this computer and opens the game in the
# browser. Keep this window open while you play; close it to stop.
cd "$(dirname "$0")/game" || exit 1
PORT=8777
URL="http://localhost:$PORT"
echo "Grand Theft Oslo: $URL"
echo "Keep this window open while you play. Close it to stop."
(sleep 2; open "$URL") &
if command -v node >/dev/null 2>&1; then
  exec node tools/serve.mjs "$PORT"
elif [ -x /usr/bin/ruby ]; then
  exec /usr/bin/ruby -run -e httpd . -p "$PORT" -b 127.0.0.1
elif command -v python3 >/dev/null 2>&1; then
  exec python3 -m http.server "$PORT" --bind 127.0.0.1
fi
echo
echo "No web server found. Install Node.js from https://nodejs.org and run this again."
read -r -p "Press Enter to close."
