#!/bin/bash
set -euo pipefail

# Set defaults
export VITE_API_URL=${VITE_API_URL:-http://localhost:8080}
export REMOTE_GUI_FE=${REMOTE_GUI_FE:-31800}
export REMOTE_GUI_BE=${REMOTE_GUI_BE:-8080}

# Auto-derive FRONTEND_URL for CORS if not explicitly set.
# Extracts scheme+host from VITE_API_URL, swaps in the frontend port.
if [ -z "${FRONTEND_URL:-}" ]; then
    _api_base=$(echo "$VITE_API_URL" | sed 's|^\(https\?://[^:/]*\).*|\1|')
    export FRONTEND_URL="${_api_base}:${REMOTE_GUI_FE}"
fi

# How the environment variable flows through Docker
# The chain: docker-compose.yaml -> start.sh -> main.py

# VITE_API_URL is already set in docker-compose.yaml (e.g., http://192.168.1.206:8000). This tells the browser where the backend is.

# start.sh now auto-derives FRONTEND_URL from VITE_API_URL if it's not explicitly set. It extracts the scheme + host (http://192.168.1.206) and appends the frontend port (REMOTE_GUI_FE), producing something like http://192.168.1.206:31800. This tells the backend which origin to accept CORS from.

# main.py reads FRONTEND_URL from the environment and uses it for the CORS allowed origins list (the code we changed earlier).

# Write runtime config into the built frontend
cat > /app/CLI/local-cli-fe-full/build/config.js <<CONF
window._env_ = {
  VITE_API_URL: "${VITE_API_URL}"
};
CONF

# Ensure log directory exists
mkdir -p /app/CLI/local-cli-backend/logs

# Start backend
$VIRTUAL_ENV/bin/uvicorn CLI.local-cli-backend.main:app --host 0.0.0.0 --port ${REMOTE_GUI_BE} &

# Serve frontend with SPA fallback (serves index.html for all unknown routes)
python3 - <<PYEOF
import os, sys
from http.server import HTTPServer, SimpleHTTPRequestHandler

BUILD_DIR = "/app/CLI/local-cli-fe-full/build"
PORT = int(os.environ.get("REMOTE_GUI_FE", 31800))

class SPAHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BUILD_DIR, **kwargs)

    def do_GET(self):
        # If file exists, serve it normally; otherwise serve index.html
        path = BUILD_DIR + self.path.split("?")[0]
        if not os.path.exists(path) or os.path.isdir(path) and not os.path.exists(path + "/index.html"):
            self.path = "/index.html"
        return super().do_GET()

    def log_message(self, format, *args):
        pass  # suppress per-request logs

print(f"Serving frontend on port {PORT}", flush=True)
HTTPServer(("0.0.0.0", PORT), SPAHandler).serve_forever()
PYEOF
