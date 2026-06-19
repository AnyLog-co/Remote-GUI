# Running the Backend Tunnel in Docker - Setup Guide

## Overview

This guide explains how to stand up the `backend-tunnel` sidecar that
connects the Remote-GUI FastAPI backend to a Grafana instance running on
a remote AnyLog node via a reverse SSH tunnel. There are two main
approaches:

1. **Standalone `docker run`** (simplest — sidecar runs as a separate container)
2. **Docker Compose service** (recommended for production — sidecar is part of the same stack as `remote-gui`)

The `remote-gui` container itself is assumed to already be running. For
the base stack setup, see [`README.md`](./README.md).

---

## Approach 1: Standalone `docker run` (Recommended for first-time setup)

The simplest way to bring up the tunnel without touching the existing
compose file. Useful when iterating on the tunnel config or testing a
node before committing the sidecar to compose.

### Prerequisites

- Docker Desktop 4.x+ (Windows / macOS) or Docker Engine 20.10+ (Linux)
- The `remote-gui` container already running (`docker compose up -d` from the repo root)
- SSH access to the AnyLog node (you need to be able to add a public key to its `authorized_keys`)
- A free port on the node for the reverse forward (default: `8000`)

### Step 1: Generate the Tunnel Key Pair

From the repo root:

```bash
# Create the .tunnel directory if it doesn't exist
mkdir -p .tunnel

# Generate an ed25519 key with no passphrase
ssh-keygen -t ed25519 -f .tunnel/tunnel_key -N "" -C "remote-gui-tunnel"

# Lock down the private key (Linux/macOS only; Windows handles ACLs differently)
chmod 600 .tunnel/tunnel_key
```

This produces:

- `.tunnel/tunnel_key` &nbsp; ← private key, mounted into the sidecar
- `.tunnel/tunnel_key.pub` &nbsp; ← public key, copied to the node

**Verify the keys exist:**

```bash
ls -la .tunnel/
```

**Tag Format**: `ssh-ed25519 <base64> remote-gui-tunnel`

> **Tip: Add `.tunnel/tunnel_key` to `.gitignore` immediately.** The
> private key is a credential — committing it is equivalent to publishing
> SSH access to your backend. The `.pub` file is safe to commit.

### Step 2: Authorize the Key on the AnyLog Node

SSH into the node as the user that will own the tunnel session:

```bash
ssh <NODE_USER>@<NODE_IP>
```

On the node, append the public key to `authorized_keys`. The minimal version:

```bash
mkdir -p ~/.ssh && chmod 700 ~/.ssh
cat >> ~/.ssh/authorized_keys
# now paste the contents of .tunnel/tunnel_key.pub, press Enter, then Ctrl-D
chmod 600 ~/.ssh/authorized_keys
```

The hardened version (recommended) restricts the key to *only* opening
the tunnel:

```
command="echo 'tunnel only'",no-pty,no-X11-forwarding,permitopen="localhost:8000" ssh-ed25519 AAAA... remote-gui-tunnel
```

Paste that whole line as a single entry in `authorized_keys`. If the
key is ever exfiltrated, the attacker still cannot get a shell or open
other forwards.

Then make sure `sshd` allows reverse forwards. Edit `/etc/ssh/sshd_config`:

```
AllowTcpForwarding yes
ClientAliveInterval 30
ClientAliveCountMax 3
```

`GatewayPorts` is **not** needed — Grafana queries `localhost` on the node.

Reload `sshd`:

```bash
sudo systemctl reload sshd
```

### Step 3: Start the Sidecar Container

From the repo root on the docker host:

```bash
docker run -d \
  --name backend-tunnel \
  --restart unless-stopped \
  --network remote-gui_default \
  -v "$(pwd)/.tunnel/tunnel_key:/id_rsa:ro" \
  -e SSH_HOSTUSER=<NODE_USER> \
  -e SSH_HOSTNAME=<NODE_IP> \
  -e SSH_HOSTPORT=22 \
  -e SSH_TUNNEL_PORT=8000 \
  -e SSH_TUNNEL_HOST=remote-gui \
  -e SSH_TUNNEL_REMOTE_PORT=8000 \
  -e SSH_MODE=reverse \
  jnovack/autossh:latest
```

**Flag-by-flag**:

| Flag | Meaning |
|------|---------|
| `--network remote-gui_default` | Join the compose-created network so the sidecar can resolve `remote-gui` by DNS. |
| `-v .../tunnel_key:/id_rsa:ro` | Mount the private key read-only at the path `autossh` reads. |
| `SSH_TUNNEL_HOST=remote-gui` | Forward destination = the backend container's docker DNS name. |
| `SSH_TUNNEL_REMOTE_PORT=8000` | Forward destination port — must match the port uvicorn binds to inside `remote-gui`. |
| `SSH_MODE=reverse` | Open a remote (`-R`) forward, not local. |

> **Tip: Confirm the network name first.** Compose names its default
> network `<project>_default`, where `<project>` is the parent directory
> name unless overridden. Run `docker network ls` and copy the exact
> name. If the flag is wrong, the sidecar comes up but the tunnel can't
> find `remote-gui`.

### Step 4: Verify the Tunnel Is Up

**On the docker host:**

```bash
docker logs -f backend-tunnel
# Expect: "Forwarding remote port 8000 -> remote-gui:8000"
```

**On the AnyLog node:**

```bash
ssh <NODE_USER>@<NODE_IP> 'ss -tlnp | grep :8000'
# Expect: sshd listening on 127.0.0.1:8000

ssh <NODE_USER>@<NODE_IP> 'curl -I http://localhost:8000'
# Expect: HTTP/1.1 200 OK (or whatever the backend returns at /)
```

### Step 5: Add the Backend as a Grafana Data Source

Open Grafana in a browser at `http://<NODE_IP>:3000` and log in.

**5a. Install the Infinity plugin** (skip if already installed)

The backend speaks JSON over HTTP, and Grafana's built-in data sources
don't handle generic REST endpoints. The **Infinity** plugin does.
To install:

1. In the left sidebar, click the gear icon → **Administration**
2. Click **Plugins and data → Plugins**
3. Search for `Infinity`
4. Click the result authored by **Yesoreyeram / Grafana Labs**
5. Click **Install** in the top-right of the plugin page
6. Wait for the install to finish (takes a few seconds)

> If you don't see Plugins under Administration, your Grafana instance
> may have plugin installation disabled by config. Ask whoever runs the
> node to set `allow_loading_unsigned_plugins` or to install Infinity
> via the CLI: `grafana-cli plugins install yesoreyeram-infinity-datasource`.

**5b. Add the data source**

1. In the left sidebar, click the gear icon → **Connections → Data sources**
   (older Grafana versions: **Configuration → Data sources**)
2. Click the blue **Add data source** button in the top-right
3. In the search box, type `Infinity`
4. Click the **Infinity** result to open the configuration page

**5c. Configure the connection**

On the Infinity data source configuration page:

1. **Name** (top of the page): give it something obvious like
   `Remote-GUI Backend`. This is what shows up in panel data-source
   dropdowns later.
2. Scroll to the **Authentication** section. Leave **Auth type** set to
   **No Auth** (the tunnel's `permitopen` restriction is what protects
   the endpoint; no token is required).
3. Scroll to the **URL, Headers & Params** section.
4. In the **Allowed hosts** field, click **+ Add** and enter:
   ```
   http://localhost:8000
   ```
   This is the only URL the data source will be permitted to query,
   which is a sensible safety guard.
5. Leave the rest of the fields at their defaults.

**5d. Save and test**

1. Scroll to the bottom of the page
2. Click **Save & test**
3. You should see a green banner: `Settings saved`

> If you see a red banner instead, check the troubleshooting section
> below — it's almost always the tunnel side, not the Grafana side.

**5e. Import the pre-built dashboard**

You do not need to build the monitoring dashboard from scratch. The
repo ships with a Grafana dashboard JSON file that already has every
panel wired up against the `Remote-GUI Backend` data source you just
configured. Importing it gives you the full monitoring view in one
click.

The dashboard JSON lives in the repo at:

```
grafana/remote-gui-dashboard.json
```

(or wherever your team has placed it; check the repo root or a
`grafana/` subfolder).

To import:

1. Open the file on the docker host machine and copy its full contents
   to your clipboard. Alternatively, transfer the file to the AnyLog
   node and open it from there.
2. In Grafana's left sidebar, click **Dashboards**.
3. Click the **New** dropdown in the top-right and pick **Import**
   (older Grafana versions: **+ → Import**).
4. On the import page, you have two options:
   - **Paste the JSON**: paste the file contents into the "Import via
     panel json" text area and click **Load**.
   - **Upload the file**: click **Upload dashboard JSON file** and
     pick `remote-gui-dashboard.json` from disk.
5. On the next screen, give the dashboard a name (or leave the default),
   pick a folder if you use folders, and under the data source
   selector, make sure it is mapped to the **Remote-GUI Backend** data
   source you created in step 5c. If the dashboard JSON references it
   by name, Grafana will auto-select it.
6. Click **Import**.

The dashboard opens immediately with all panels populated. If any
panel shows "No data," it almost always means the tunnel side has a
problem — jump to the troubleshooting section below.

**5f. (Optional) Build custom panels**

If you want to add your own panels beyond the pre-built dashboard:

1. Left sidebar → **Dashboards → New → New dashboard**
2. Click **+ Add visualization**
3. In the data source picker, pick **Remote-GUI Backend**
4. In the query editor:
   - **Type**: `JSON`
   - **Source**: `URL`
   - **Format**: `Table` (or `Time series` if the endpoint returns
     time-stamped data)
   - **Method**: `GET`
   - **URL**: `http://localhost:8000/` (or whatever specific backend
     endpoint you want this panel to query)
5. Click **Run query**. You should see the backend's response rendered
   in the preview area.

The URL is stable forever: it always points back through the tunnel,
regardless of where the docker host actually runs. From here on out,
any new panel just picks `Remote-GUI Backend` from the data source
dropdown and points at whatever endpoint it needs.

---

## Approach 2: Docker Compose Service (Recommended for production)

Once the tunnel is proven, move the sidecar into the compose file so it
comes up and down with the rest of the stack.

### Step 1: Add the Service to `docker-compose.yaml`

Append to the `services:` block:

```yaml
  backend-tunnel:
    image: jnovack/autossh:latest
    container_name: backend-tunnel
    restart: unless-stopped
    depends_on:
      - remote-gui
    volumes:
      - ./.tunnel/tunnel_key:/id_rsa:ro
    environment:
      SSH_HOSTUSER: <NODE_USER>
      SSH_HOSTNAME: <NODE_IP>
      SSH_HOSTPORT: 22
      SSH_TUNNEL_PORT: 8000
      SSH_TUNNEL_HOST: remote-gui
      SSH_TUNNEL_REMOTE_PORT: 8000
      SSH_MODE: reverse
```

No `networks:` block is needed — compose puts both services on the
default network automatically, and DNS works out of the box.

### Step 2: Bring the Stack Up

```bash
docker compose up -d
```

Both `remote-gui` and `backend-tunnel` start together. `depends_on`
ensures the backend container is created before the sidecar tries to
join the network, though the sidecar will retry if it isn't ready yet.

### Step 3: Use a `.env` File for the Node Coordinates

To avoid editing the compose file every time the node moves, parameterize:

```yaml
    environment:
      SSH_HOSTUSER: ${TUNNEL_NODE_USER}
      SSH_HOSTNAME: ${TUNNEL_NODE_IP}
      SSH_HOSTPORT: ${TUNNEL_NODE_PORT:-22}
      SSH_TUNNEL_PORT: 8000
      SSH_TUNNEL_HOST: remote-gui
      SSH_TUNNEL_REMOTE_PORT: 8000
      SSH_MODE: reverse
```

Create `.env` next to `docker-compose.yaml`:

```
TUNNEL_NODE_USER=ubuntu
TUNNEL_NODE_IP=10.0.0.50
TUNNEL_NODE_PORT=22
```

> **Tip: Add `.env` to `.gitignore`.** Node IPs and usernames are not
> secrets, but they couple your local config to a specific environment
> and shouldn't follow the repo across deployments.

### Step 4: Verify

Same as Approach 1, Step 4. Logs should show "Forwarding remote port
8000 -> remote-gui:8000", and `localhost:8000` on the node should
respond.

---

## Integration with Grafana

### Recommended Plugins

The tunnel exposes HTTP, so any Grafana data source that speaks HTTP
works. The two most practical:

| Plugin | Best For |
|--------|----------|
| **Infinity** | REST endpoints with arbitrary JSON shapes, CSV, XML, GraphQL. The pragmatic default. |
| **JSON API** | When the backend has stable, schema-described endpoints. Lighter than Infinity. |

Both are installable from Grafana's plugin catalog.

### Configuration Pattern

Once the data source is wired:

- **Liveness**: a single-stat panel hitting a known endpoint, alerting
  when it stops returning `200`.
- **Throughput**: time-series of `/api/...` request counts, sourced from
  a backend endpoint that exposes counters.
- **Error rate**: count of 4xx/5xx over a rolling window.

See [`BACKEND_TUNNEL_README.md`](./BACKEND_TUNNEL_README.md) for the
full set of monitoring uses.

---

## Testing Checklist

### Tunnel Key Setup

- [ ] `.tunnel/tunnel_key` exists and has permissions `0600`
- [ ] `.tunnel/tunnel_key.pub` exists
- [ ] `.tunnel/tunnel_key` is listed in `.gitignore`
- [ ] Public key is appended to the node user's `~/.ssh/authorized_keys`
- [ ] `~/.ssh` permissions are `0700`, `authorized_keys` is `0600`

### Node-Side Configuration

- [ ] `AllowTcpForwarding yes` in `/etc/ssh/sshd_config`
- [ ] `sshd` reloaded after config changes
- [ ] Manual `ssh -i .tunnel/tunnel_key <NODE_USER>@<NODE_IP> -R 8000:localhost:8000 -N` from the host succeeds

### Sidecar Container

- [ ] `docker run` (or compose up) starts the container without error
- [ ] `docker logs backend-tunnel` shows "Forwarding remote port 8000 -> remote-gui:8000"
- [ ] `--network` flag matches the actual compose network name
- [ ] Restart of the sidecar (`docker restart backend-tunnel`) re-establishes the tunnel in under 10 seconds

### End-to-End

- [ ] On the node: `ss -tlnp | grep :8000` shows `sshd` listening
- [ ] On the node: `curl -I http://localhost:8000` returns the backend's response
- [ ] In Grafana: a data source pointing at `http://localhost:8000` tests green
- [ ] Killing `remote-gui` temporarily breaks the tunnel; restoring it recovers without intervention

---

## Troubleshooting

### Sidecar exits immediately

Run without `-d` to see the error inline:

```bash
docker run --rm \
  --network remote-gui_default \
  -v "$(pwd)/.tunnel/tunnel_key:/id_rsa:ro" \
  -e SSH_HOSTUSER=<NODE_USER> \
  -e SSH_HOSTNAME=<NODE_IP> \
  -e SSH_TUNNEL_PORT=8000 \
  -e SSH_TUNNEL_HOST=remote-gui \
  -e SSH_TUNNEL_REMOTE_PORT=8000 \
  -e SSH_MODE=reverse \
  jnovack/autossh:latest
```

Common causes: bad permissions on `tunnel_key`, missing `SSH_MODE`,
wrong network name.

### `Permission denied (publickey)` in logs

The public key isn't authorized on the node, or `SSH_HOSTUSER` doesn't
match the user that owns `authorized_keys`. Test manually:

```bash
ssh -i .tunnel/tunnel_key -o IdentitiesOnly=yes <NODE_USER>@<NODE_IP> echo ok
```

If that fails, the sidecar will too.

### Tunnel up but Grafana data source fails

The sidecar is forwarding, but the backend isn't actually listening on
container port `8000`. Inside the container:

```bash
docker exec remote-gui sh -c 'ss -tlnp || cat /proc/net/tcp'
```

If uvicorn is bound to a different port (e.g. `8080`), the
`remote-gui` image and its `start.sh` have drifted. Rebuild the image
from the local `Dockerfile`.

### "Could not resolve hostname remote-gui"

Wrong docker network. Run `docker network ls`, then either re-run with
the correct `--network` flag or join the sidecar to multiple networks
with extra `--network` flags.

### Tunnel reconnects constantly

Underlying network is flaky, or `sshd` on the node has aggressive
client-alive settings. Increase `ClientAliveInterval` on the node, or
tune `SSH_KEEPALIVE_INTERVAL` on the sidecar.

---

## Tearing It Down

### Standalone

```bash
docker stop backend-tunnel && docker rm backend-tunnel
```

### Compose

```bash
docker compose stop backend-tunnel
docker compose rm -f backend-tunnel
# Or to remove from the running stack:
docker compose up -d --scale backend-tunnel=0
```

Then remove the public key from the node's `authorized_keys` if the
key is no longer needed. The `.tunnel/` directory on the host can be
deleted once both halves of the key are revoked.
