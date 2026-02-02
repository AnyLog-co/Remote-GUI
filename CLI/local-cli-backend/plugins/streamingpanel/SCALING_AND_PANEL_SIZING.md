# Streaming Panel: How Scaling and Panel Sizing Work

## End-to-end flow

### 1. Loading stream list (backend)

- **`GET /streamingpanel/streams`** calls `get_stream_options()`.
- Optionally, **ffprobe** is run on the example stream URL (2s timeout) to get video **width**, **height**, and **aspect_ratio** (width/height).
- **If ffprobe succeeds**: every stream option in the response includes `width`, `height`, `aspect_ratio`.
- **If ffprobe fails** (not installed, or URL is an HTML page so there’s no raw video stream): options have **no** `width`/`height`/`aspect_ratio`.

**Important:** Your URL (`http://172.234.244.11:8888/stream/youtube-ai`) is almost certainly an **HTML player page**, not a direct video stream. ffprobe typically **cannot** get dimensions from an HTML URL, so probe often fails and the API returns no dimensions.

---

### 2. Frontend: panel (tile) sizing

- For each stream tile, the **video container** div uses:
  - **`aspectRatio`**: `stream.aspect_ratio` if present, else `"16 / 9"`.
  - **`width: "100%"`**, **`minHeight: "180px"`**.
- So:
  - **With probe data**: panel aspect ratio = stream’s aspect ratio.
  - **Without probe data**: panel is 16:9.
- The **iframe** that loads the player is `position: absolute; top/left/right/bottom: 0; width/height: 100%`, so it fills that video container. The **player page** therefore gets exactly the size of the panel’s video area.

---

### 3. Player URL

- **`getPlayerIframeUrl(stream.url, stream.width, stream.height)`** builds:
  - `.../streamingpanel/player?url=<encoded_stream_url>`
  - If `stream.width` and `stream.height` are present and > 0: **`&w=<width>&h=<height>`**
- **When probe failed**: `stream.width` and `stream.height` are undefined, so the URL has **no** `w` or `h`. The player then uses **1920** and **1080** as defaults.

---

### 4. Player page (inside the iframe)

- The player HTML runs **inside** the iframe, so its viewport = the panel’s video area size (e.g. 400×225 for a 16:9 panel).
- It reads query params:
  - **`url`**: the stream URL (loaded in an inner iframe).
  - **`w`**, **`h`**: default **1920**, **1080** if missing.
- Structure:
  - **`#wrap`**: `position: absolute; top/left/right/bottom: 0` → fills the iframe (same size as the panel video area). `overflow: hidden` to clip the scaled content.
  - **`#scaler`**: a div with fixed size **streamW × streamH** (e.g. 1920×1080). Contains **`#streamFrame`**.
  - **`#streamFrame`**: an iframe with the same size as the scaler; **`src = url`** (your stream URL). So the stream page is **rendered at** 1920×1080 (or whatever w/h we passed).
- **Scaling (fit())**:
  1. **`w = wrap.offsetWidth`**, **`h = wrap.offsetHeight`** → size of the panel video area (the “hole” we want to fill).
  2. **`s = Math.max(w / streamW, h / streamH)`** → scale factor so that the scaler, when scaled by `s`, **covers** (w, h) (scale-to-cover: no black bars from our side).
  3. **`tx = (w - streamW * s) / 2`**, **`ty = (h - streamH * s) / 2`** → translate to center the scaled content.
  4. **`scaler.style.transform = 'translate(tx, ty) scale(s)'`** → the 1920×1080 (or streamW×streamH) content is scaled and centered; any overflow is clipped by `#wrap`.

So **our** scaling is “scale the inner iframe (stream page) so it covers the panel.” That only removes black bars that would be introduced by our fixed 1920×1080 frame. It does **not** remove black that is **inside** the stream page (e.g. letterboxing in their HTML player).

---

## Why you still see black

1. **Probe usually doesn’t run on your URL**  
   The stream URL is an HTML page. ffprobe doesn’t get a video stream from that, so:
   - No `width`/`height`/`aspect_ratio` in the API.
   - Panel uses 16:9, player uses 1920×1080.

2. **Black is inside the stream page**  
   The stream URL returns an **HTML player** that draws a video and likely adds its own letterboxing (black) around it. We scale the **entire** 1920×1080 page (including that black). So the scaled result still shows the same letterboxing; we’re just zooming the whole page.

3. **Possible timing bug**  
   If `fit()` runs when the iframe (and thus `#wrap`) has no size yet, `wrap.offsetWidth`/`offsetHeight` can be 0, so we never set a transform. We’ll fix this by retrying when size is 0.

---

## What would fix it

- **Option A – Probe a real video URL**  
  If you have a **direct** stream URL (e.g. HLS `.m3u8` or an MP4), use that for probing (and optionally for the player). Then we get real dimensions and the panel ratio can match the stream; with scale-to-cover that can remove our-side black (stream content may still have its own letterboxing).

- **Option B – No scaling, stream fills the iframe**  
  If the stream page is written to fill 100% of the viewport (no fixed size, no letterboxing), we can drop the scaler and use a single full-size iframe. Then the stream page gets the panel size and can fill it. That only works if the stream page is under your control or already responsive.

- **Option C – Accept cropping**  
  Keep scale-to-cover. We already use `Math.max(...)` so we always fill the panel; any extra is cropped. So we don’t add black. Remaining black can only be from the stream page’s own layout.

Next step in code: ensure `fit()` runs after the iframe has a non-zero size (retry when `w` or `h` is 0) so scaling is always applied.

---

## Why only ~6 streams load (7+ show black)

**Cause:** Browsers enforce a **per-origin connection limit** (HTTP/1.1). Typically only **about 6 simultaneous connections** to the same host (e.g. `172.234.244.11:8888`) are allowed. Each stream panel opens a connection to that host; the 7th, 8th, etc. are queued or fail, so those panels stay black.

**What we do:**
- Each dummy stream uses a unique URL (query param `?tile=stream-N`) so the browser doesn’t treat them as one resource. The limit is still **per host**, not per URL, so 7+ panels to the same server still hit the cap.
- The UI shows a **warning** when more than 6 streams are on the panel, explaining the limit and suggesting using 6 or fewer per server or streams from different servers.

**Workarounds:**
- Use **6 or fewer panels** when all streams come from the same server.
- Use streams from **different servers** (different hostnames) so each origin has its own 6-connection budget.
- On the server side: some stream servers also limit concurrent viewers; that limit is separate from the browser’s and would require server/config changes to increase.
