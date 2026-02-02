# Streaming Panel Plugin - Multi-stream video panel
# Eventually a command will return a list/structure of stream URLs (with labels).
# For now we use dummy data.

import json
import subprocess
from fastapi import APIRouter, Query
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from typing import List, Optional

api_router = APIRouter(prefix="/streamingpanel", tags=["Streaming Panel"])

# Dummy example URL until the real command exists
EXAMPLE_STREAM_URL = "http://172.234.244.11:8888/stream/youtube-ai"


class StreamOption(BaseModel):
    """Single stream option for dropdown/selection."""
    id: str
    url: str
    label: str
    width: Optional[int] = None
    height: Optional[int] = None
    aspect_ratio: Optional[float] = None


def probe_stream_dimensions(url: str, timeout_sec: int = 5) -> Optional[dict]:
    """
    Use ffprobe (if available) to get video width/height from a stream URL.
    Returns {"width": int, "height": int, "aspect_ratio": float} or None.
    """
    try:
        cmd = [
            "ffprobe",
            "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=width,height",
            "-of", "json",
            "-analyzeduration", "2000000",
            "-probesize", "2000000",
            url,
        ]
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout_sec,
        )
        if result.returncode != 0 or not result.stdout:
            return None
        data = json.loads(result.stdout)
        print("ffprobe data:", data)
        streams = data.get("streams") or []
        if not streams:
            return None
        s = streams[0]
        w = s.get("width")
        h = s.get("height")
        if w is None or h is None or w <= 0 or h <= 0:
            return None
        return {
            "width": int(w),
            "height": int(h),
            "aspect_ratio": round(int(w) / int(h), 4),
        }
    except (FileNotFoundError, subprocess.TimeoutExpired, json.JSONDecodeError, KeyError):
        return None


def get_stream_options() -> List[dict]:
    """
    Return list of available stream options (URL + label, optional dimensions from probe).
    TODO: Replace with real implementation that calls the command
    that returns URLs/structure. For now returns dummy data.
    """
    # Dummy data: each entry gets a unique URL (query param) so the stream server or browser
    # doesn't treat multiple tiles as the same connection (many servers limit concurrent
    # connections to the same URL, which can cause streams 7+ to show black).
    base = []
    for i in range(1, 15):
        sep = "&" if "?" in EXAMPLE_STREAM_URL else "?"
        base.append({
            "id": f"stream-{i}",
            "url": f"{EXAMPLE_STREAM_URL}{sep}tile=stream-{i}",
            "label": f"Stream {i} (YouTube AI)",
        })
    # Probe first stream so panel aspect ratio can match (requires ffprobe, short timeout)
    probed = probe_stream_dimensions(EXAMPLE_STREAM_URL, timeout_sec=2)
    if probed:
        for opt in base:
            opt["width"] = probed["width"]
            opt["height"] = probed["height"]
            opt["aspect_ratio"] = probed["aspect_ratio"]
    return base


@api_router.get("/")
async def streamingpanel_info():
    """Plugin info."""
    return {
        "name": "Streaming Panel Plugin",
        "version": "1.0.0",
        "description": "Multi-stream video panel (e.g. security camera livestream grid)",
    }


@api_router.get("/streams", response_model=List[StreamOption])
async def get_streams():
    """
    Get list of available stream URLs (with labels) for the dropdown.
    TODO: Replace with real command/API that returns the actual list.
    """
    return get_stream_options()


@api_router.get("/probe")
async def probe_stream(
    url: str = Query(..., description="Stream URL to probe for dimensions (requires ffprobe)"),
):
    """
    Probe stream dimensions using ffprobe if available.
    Returns { width, height, aspect_ratio } or { error }.
    """
    info = probe_stream_dimensions(url)
    if info:
        return info
    return {"error": "Could not get dimensions (ffprobe not available or stream not probeable)"}


# Player page: embed stream in fixed-size iframe and scale to COVER so it fills the panel (no black).
PLAYER_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Stream</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; overflow: hidden; background: #000; }
    body { position: absolute; top: 0; left: 0; right: 0; bottom: 0; }
    #wrap {
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      overflow: hidden;
    }
    #scaler {
      position: absolute;
      top: 0;
      left: 0;
      transform-origin: 0 0;
    }
    #streamFrame { border: none; display: block; }
  </style>
</head>
<body>
  <div id="wrap">
    <div id="scaler">
      <iframe id="streamFrame" allow="autoplay; fullscreen" allowfullscreen></iframe>
    </div>
  </div>
  <script>
    (function() {
      var params = new URLSearchParams(window.location.search);
      var url = params.get('url') || '';
      var streamW = Math.max(1, parseInt(params.get('w'), 10) || 1920);
      var streamH = Math.max(1, parseInt(params.get('h'), 10) || 1080);
      var frame = document.getElementById('streamFrame');
      var scaler = document.getElementById('scaler');
      var wrap = document.getElementById('wrap');
      scaler.style.width = streamW + 'px';
      scaler.style.height = streamH + 'px';
      frame.style.width = streamW + 'px';
      frame.style.height = streamH + 'px';
      if (url) frame.src = url;

      function fit() {
        var w = wrap.offsetWidth;
        var h = wrap.offsetHeight;
        if (w <= 0 || h <= 0) return false;
        var s = Math.max(w / streamW, h / streamH);
        var tx = (w - streamW * s) / 2;
        var ty = (h - streamH * s) / 2;
        scaler.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + s + ')';
        return true;
      }

      fit();
      window.addEventListener('resize', fit);
      window.addEventListener('load', function() { setTimeout(fit, 0); });
      var retries = 0;
      function fitWhenReady() {
        if (fit()) return;
        if (retries++ < 50) setTimeout(fitWhenReady, 100);
      }
      setTimeout(fitWhenReady, 100);
      if (window.ResizeObserver) {
        new ResizeObserver(function() { requestAnimationFrame(fit); }).observe(wrap);
      }
    })();
  </script>
</body>
</html>
"""


@api_router.get("/player", response_class=HTMLResponse)
async def stream_player(
    url: str = Query(..., description="Stream URL to embed"),
    w: Optional[int] = Query(None, description="Stream width (from probe); panel ratio will match"),
    h: Optional[int] = Query(None, description="Stream height (from probe)"),
):
    """
    Serves an HTML page that embeds the stream and scales to COVER the panel.
    Pass w and h (from /streams or /probe) so the player uses the stream's aspect ratio = no black bars.
    """
    return HTMLResponse(PLAYER_HTML)
