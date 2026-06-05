#!/bin/bash
set -euo pipefail

# Set defaults
export VITE_API_URL=${VITE_API_URL:-http://localhost:8080}
export REMOTE_GUI_FE=${REMOTE_GUI_FE:-31800}
export REMOTE_GUI_BE=${REMOTE_GUI_BE:-8080}

# Auto-derive FRONTEND_URL for CORS if not explicitly set.
# Extracts scheme+host from VITE_API_URL, swaps in the frontend port.
# If VITE_API_URL points at localhost/127.0.0.1, leave FRONTEND_URL unset so
# the backend allows LAN browser origins it cannot know from inside Docker.
if [ -z "${FRONTEND_URL:-}" ]; then
    _api_base=$(echo "$VITE_API_URL" | sed 's|^\(https\?://[^:/]*\).*|\1|')
    _api_host=$(echo "$VITE_API_URL" | sed -E 's|^[a-zA-Z][a-zA-Z0-9+.-]*://([^/:]+).*|\1|')
    case "$_api_host" in
        localhost|127.*|0.0.0.0|"[::1]"|"::1")
            ;;
        *)
            export FRONTEND_URL="${_api_base}:${REMOTE_GUI_FE}"
            ;;
    esac
fi

# How the environment variable flows through Docker
# The chain: docker-compose.yaml -> start.sh -> main.py

# VITE_API_URL is already set in docker-compose.yaml (e.g., http://192.168.1.206:8000). This tells the browser where the backend is.

# start.sh now auto-derives FRONTEND_URL from VITE_API_URL if it's not explicitly set. It extracts the scheme + host (http://192.168.1.206) and appends the frontend port (REMOTE_GUI_FE), producing something like http://192.168.1.206:31800. This tells the backend which origin to accept CORS from.

# main.py reads FRONTEND_URL from the environment and uses it for the CORS allowed origins list (the code we changed earlier).

# Write runtime config into the built frontend. Remote browsers cannot use a
# loopback VITE_API_URL from the container environment, so config.js resolves
# loopback defaults against the hostname that served the GUI.
python3 - <<'PYCONF'
import json
import os
from pathlib import Path

build_dir = Path("/app/CLI/local-cli-fe-full/build")
configured_api_url = os.environ.get("VITE_API_URL", "")
backend_port = os.environ.get("REMOTE_GUI_BE", "8080")

config_js = f"""(function () {{
  var configuredApiUrl = {json.dumps(configured_api_url)};
  var backendPort = {json.dumps(backend_port)};

  function isLoopbackHost(host) {{
    host = String(host || '').toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
  }}

  function configuredHost(url) {{
    try {{
      return new URL(url, window.location.href).hostname;
    }} catch (_) {{
      return '';
    }}
  }}

  function sameHostApiUrl() {{
    var protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
    return protocol + '//' + window.location.hostname + ':' + backendPort;
  }}

  var apiUrl = configuredApiUrl;
  if (!apiUrl || (isLoopbackHost(configuredHost(apiUrl)) && !isLoopbackHost(window.location.hostname))) {{
    apiUrl = sameHostApiUrl();
  }}

  window._env_ = {{
    VITE_API_URL: apiUrl.replace(/\\/+$/, ''),
    REMOTE_GUI_BE: backendPort
  }};
}})();
"""

(build_dir / "config.js").write_text(config_js)
PYCONF

# Ensure log directory exists
mkdir -p /app/CLI/local-cli-backend/logs

# Start backend
$VIRTUAL_ENV/bin/uvicorn CLI.local-cli-backend.main:app --host 0.0.0.0 --port ${REMOTE_GUI_BE} &

# Serve frontend with SPA fallback (serves index.html for all unknown routes)
python3 - <<PYEOF
import os, sys
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

BUILD_DIR = "/app/CLI/local-cli-fe-full/build"
PORT = int(os.environ.get("REMOTE_GUI_FE", 31800))

class SPAHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BUILD_DIR, **kwargs)

    def handle(self):
        try:
            super().handle()
        except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
            pass

    def do_GET(self):
        try:
            # If file exists, serve it normally; otherwise serve index.html
            path = BUILD_DIR + self.path.split("?")[0]
            if not os.path.exists(path) or os.path.isdir(path) and not os.path.exists(path + "/index.html"):
                self.path = "/index.html"
            return super().do_GET()
        except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
            pass

    def log_message(self, format, *args):
        pass  # suppress per-request logs

print(f"Serving frontend on port {PORT}", flush=True)
ThreadingHTTPServer(("0.0.0.0", PORT), SPAHandler).serve_forever()
PYEOF
