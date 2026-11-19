#!/bin/bash
# Double-click this file in Finder to start ProductForge AI on this Mac (demo mode: no accounts or keys).
# First run installs dependencies (1–3 minutes). Keep the window open while you use the app;
# close it or press Ctrl+C to stop.

cd "$(dirname "$0")" || exit 1
PORT=3000
URL="http://localhost:$PORT/dashboard"

pause_and_exit() {
  echo
  read -r -p "Press Enter to close this window…"
  exit "${1:-1}"
}

echo "ProductForge AI — starting in demo mode"
echo

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js isn't installed. Install the LTS version from https://nodejs.org, then double-click this file again."
  pause_and_exit 1
fi

NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "Node.js $(node -v) is too old. Install version 20 or newer from https://nodejs.org."
  pause_and_exit 1
fi

if command -v pnpm >/dev/null 2>&1; then
  PNPM="pnpm"
elif command -v corepack >/dev/null 2>&1; then
  PNPM="corepack pnpm"
else
  PNPM="npx --yes pnpm@10.28.0"
fi

if [ ! -d node_modules ]; then
  echo "First run: installing dependencies (1–3 minutes)…"
  if ! $PNPM install; then
    echo
    echo "Installing dependencies failed — see the messages above."
    pause_and_exit 1
  fi
fi

if lsof -i ":$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Something is already running on port $PORT — opening it."
  open "$URL"
  pause_and_exit 0
fi

# Open the browser as soon as the server answers.
(
  for _ in $(seq 1 180); do
    if curl -fsS -o /dev/null "http://localhost:$PORT"; then
      open "$URL"
      exit 0
    fi
    sleep 1
  done
) &

echo "Starting the app… your browser opens $URL when it's ready."
echo "Data is saved in .data/productforge.json inside this folder."
echo
$PNPM dev --port "$PORT"
pause_and_exit $?
