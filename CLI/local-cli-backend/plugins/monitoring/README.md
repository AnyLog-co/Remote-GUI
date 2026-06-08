# Monitoring Plugin - Backend Documentation

## Overview

The Monitoring plugin makes the Remote-GUI deployment legible. Node health, query traffic, plugin state, and tunnel health are all visible through one Grafana instance running on a remote AnyLog node, with no per-host monitoring agents and no public exposure of the backend. This document describes what is observed, how Grafana connects to the FastAPI backend, what dashboards are available, and how the integration is wired end-to-end.

Grafana lives on the AnyLog node (e.g. `http://<NODE_IP>:3000`). The Remote-GUI FastAPI backend lives on a separate docker host and is reachable to Grafana over a reverse SSH tunnel. This document only describes what monitoring exists and how Grafana consumes it.

## Architecture

The monitoring layer consists of three logical modules:

1. **Backend endpoints** - The existing FastAPI endpoints reused as Grafana's data source
2. **Grafana data source** - How Grafana reaches and parses the backend over the tunnel
3. **Dashboards** - How panels are grouped for overview and drilldown

```
   [ Operator's browser ]
            |
            |  HTTPS
            v
[ Grafana on the AnyLog node :3000 ]
            |
            |  HTTP GET http://localhost:8000/...
            v
   [ Reverse SSH tunnel termination ]
            |
            v
[ FastAPI backend in remote-gui container ]
            |
            v
   [ AnyLog nodes, plugin state, internal metrics ]
```

From Grafana's perspective, the FastAPI backend looks like any other HTTP data source — it queries `http://localhost:8000` on the node, and the response comes back as if the backend were local. From the backend's perspective, it doesn't know Grafana exists; it just answers HTTP requests like it does for the React frontend.

The reverse tunnel is the bridge that makes this work without exposing the backend to the public internet. Once the tunnel is up, monitoring is purely a question of *what HTTP endpoints does the backend expose, and what panels in Grafana consume them*.

## File Structure

```
monitoring/
├── __init__.py             # Plugin initialization
├── monitoring_router.py    # FastAPI router with monitoring endpoints
├── README.md               # This file
└── DOCKER_TUNNEL_SETUP.md  # Reverse SSH tunnel deployment guide
```

### Data Flow

A single Grafana panel refresh looks like this end-to-end:

```
1. Panel timer fires (e.g. every 30s)
2. Grafana data source plugin (Infinity / JSON API) builds a request
3. Request hits http://localhost:8000/<endpoint> on the node
4. sshd on the node forwards the bytes over the SSH session
5. Sidecar receives the bytes and opens a TCP connection to remote-gui:8000
6. FastAPI backend responds with JSON
7. Response flows back through the same path
8. Grafana parses the JSON and renders the panel
```

The full round-trip is dominated by the SSH RTT between the node and the docker host. For typical 30-second refresh cadences, this is invisible. Dashboards built on this pattern remain responsive even when the operator is geographically far from either the docker host or the node.

---

## Module 1: Backend endpoints exposed to monitoring

### Purpose

The FastAPI backend already exposes endpoints that the React frontend consumes — health, node status, plugin state, auth events, etc. These same endpoints become Grafana's data source. No new "metrics" surface area was added on the backend side; the existing API is reused.

### Dependencies

- **`fastapi`** - The web framework serving every endpoint Grafana polls
- **Reverse SSH tunnel** - The transport that makes `localhost:8000` on the node resolve to the backend (see [`DOCKER_TUNNEL_SETUP.md`](./DOCKER_TUNNEL_SETUP.md))
- **AnyLog nodes** - The upstream source of node-status and query data the endpoints relay

### Detailed Component Breakdown

#### 1. Liveness and Health

The backend's root endpoint (`GET /`) and any `/health` style probes return quickly when the backend is up. Grafana polls these as the first signal that the whole stack — backend, tunnel, and node — is intact.

**Why this matters**: The single-stat panel that goes red when this stops returning `200` is the most operationally important panel in the deployment. It conflates "backend down", "tunnel down", and "node sshd down" into one alert, which is what an operator usually wants ("something between me and the data is broken").

**Frequency**: 10-30 second poll interval. Faster than that and the SSH overhead dominates; slower and operator response time suffers.

#### 2. AnyLog Node Status

The backend's node-connection endpoints (the ones the Node Picker in the UI consumes) report which AnyLog nodes are currently configured and whether each is reachable.

**Use in Grafana**: Render a table panel listing every configured node and its last-known reachability state. Color-code the rows. Operators get a one-glance view of which nodes are healthy, which are flapping, and which have gone fully dark.

**Why this matters**: Without this panel, "is node X reachable?" requires opening the UI, switching to that node, and watching for an error. With it, the answer is on the dashboard before anyone clicks anything.

#### 3. Query Activity

The backend proxies SQL and AnyLog commands on behalf of users. Each request produces an entry in the backend's logs and (if exposed) a counter in an internal metrics endpoint.

**Use in Grafana**:
- Time-series of queries per minute, broken down by node or by user
- Top-N table of the slowest queries in the last hour
- Histogram of query response times

**Why this matters**: Query traffic patterns reveal both legitimate usage spikes (e.g. a new dashboard going live) and pathological clients (one user running the same query in a tight loop). The histogram in particular surfaces "the backend is up but slow" states that liveness probes miss.

#### 4. Error Rate

Counts of 4xx and 5xx responses, surfaced from the backend's response logging.

**Use in Grafana**: A time-series with two stacked series (`4xx`, `5xx`). When the `5xx` series spikes, something on the backend or in the AnyLog nodes is broken even though the liveness probe still returns `200`. When the `4xx` series spikes, a user or client is misbehaving.

#### 5. Plugin State

Each backend plugin (report generator, image store, file auth, MCP client) maintains state worth surfacing:

| Plugin | Surfaced state | Useful panel |
|--------|----------------|--------------|
| Report Generator | Queue depth, generation duration | Time-series of jobs in flight |
| Image Store | Bytes used, image count | Single-stat with capacity alert |
| File Auth | Recent auth failures | Bar gauge of failures per hour |
| MCP Client | Connection state to AnyLog MCP server | Single-stat: connected / disconnected |

**Why per-plugin panels matter**: A backend can be "up" by liveness, "fast" by latency, and still have a specific plugin silently failing. Plugin-level panels catch this without requiring operators to know which plugin is suspect.

---

## Module 2: Grafana data source configuration

### Purpose

Grafana needs to know how to reach the backend, in what format, and which endpoints map to which panels. The data source is the single point of configuration.

### Dependencies

- **Grafana 9.x+** running on the AnyLog node
- **A REST-capable data source plugin** - Infinity (recommended) or JSON API
- **The tunnel URL** - `http://localhost:8000`, stable for the life of the deployment

### Detailed Component Breakdown

#### 1. Plugin Choice

The backend speaks JSON over HTTP. Two Grafana plugins fit naturally:

**Infinity (recommended)** — handles arbitrary JSON shapes, supports JSONPath / UQL for picking values out of responses, and accepts CSV / XML if the backend ever grows alternative formats. The backend's endpoints were not designed with a fixed schema in mind; each returns whatever shape made sense for the React frontend. Infinity's flexible parsing handles this without requiring backend changes.

**JSON API** — lighter than Infinity, but expects each panel to map cleanly to a single endpoint returning a flat JSON object. Good for endpoints with stable, simple shapes. Use it when a specific dashboard only consumes a small number of endpoints with predictable structure.

#### 2. URL Configuration

A single data source instance with URL `http://localhost:8000` is enough for all backend-derived panels. Authentication is not required because the only thing on the node that can reach this URL is Grafana itself (the sidecar's `permitopen` on the node restricts the tunnel to `localhost:8000`).

**Why one data source**: Splitting per-endpoint into multiple data sources adds operational toil — same tunnel, same backend, same URL — for no panel-side benefit.

#### 3. Refresh Intervals

| Panel type | Refresh interval | Reasoning |
|------------|-----------------|-----------|
| Liveness | 10-30s | Fast enough to alert; slow enough to not load the tunnel |
| Node status | 30-60s | AnyLog connectivity changes on minutes, not seconds |
| Query throughput | 30s | Standard for traffic charts |
| Error rate | 30s | Stacked with throughput |
| Plugin state | 60s | Slowest-moving signals |

Setting a global "min refresh interval" of `10s` at the dashboard level prevents accidentally configuring a panel that hammers the tunnel.

---

## Module 3: Dashboard structure

### Purpose

Group panels into dashboards that match how operators actually look at the system: a top-level overview for "is everything fine", and per-area drilldowns for diagnosis.

### Dependencies

- **A configured data source** (Module 2)
- **Backend endpoints returning data** (Module 1)
- **Grafana variables** (e.g. `$node`) for portability across environments

### Detailed Component Breakdown

#### 1. Dashboard: Remote-GUI Overview

The dashboard operators open first. Single-row layout, all single-stat or short time-series panels:

```
[ Backend liveness ] [ Tunnel uptime ] [ Connected nodes ] [ QPS now ]
[ Error rate (1h) ] [ Slowest query (1h) ] [ Active users ] [ Plugin health roll-up ]
```

Goal: every panel green = the system is fine. Any panel red = open the corresponding drilldown.

#### 2. Dashboard: Query Activity

For diagnosing performance and traffic issues:

- Time-series of queries per minute (1h window, broken down by node)
- Heatmap of query duration over time
- Top-10 slowest queries (table)
- Top-10 most active users (table)
- Time-series of error responses, separated by status code

#### 3. Dashboard: Node Health

For diagnosing AnyLog-side issues:

- Table of configured nodes with reachability state
- Per-node response time over time
- Per-node error count over time
- Geographic / IP map if relevant

#### 4. Dashboard: Plugin Health

One row per plugin, each containing:

- A connection / liveness single-stat
- Plugin-specific state panels (queue depth, store size, last error)

Operators reach this dashboard only when the Overview's "Plugin health roll-up" turns yellow.

**Why this structure**: The three drilldowns map onto the three things that go wrong in this system: the network path is bad (Tunnel uptime, Node health), the query traffic is bad (Query activity), or a specific plugin is bad (Plugin health). Operators do not need to know which drilldown to open — the Overview tells them.

---

## Error Handling Strategy

### Backend Unreachable

- Every Grafana panel sourced from the tunnel shows "no data" within one refresh cycle
- The Overview liveness panel goes red, conflating backend / tunnel / node failure into one signal
- Operators open `DOCKER_TUNNEL_SETUP.md` troubleshooting rather than guessing the layer

### Partial Failure

- A single AnyLog node going dark affects only the panels that reference it; the rest stay green
- A single plugin failing silently is caught by its per-plugin panel, not the liveness probe

### Stale Data

- Cached backend responses (`Cache-Control` headers) can make panels render old values; refresh intervals and cache windows must be reconciled
- Alerts use a "for" duration so a single bad sample never pages

---

## Alerting

### Purpose

Some panels matter enough to wake people up at 3am, and some don't. Grafana's alerting layer turns the "important" panels into notifications.

### Recommended Alerts

| Alert | Trigger | Severity |
|-------|---------|----------|
| Backend liveness down | `GET /` fails for > 1 minute | Page on-call |
| Tunnel reconnect storm | More than 5 reconnects in 5 minutes | Page on-call |
| Error rate spike | 5xx rate > 5% for > 5 minutes | Page on-call |
| Node unreachable | Specific node down for > 10 minutes | Ticket only |
| Plugin queue saturated | Report generator queue > 100 for > 15 minutes | Ticket only |
| Image store > 90% capacity | Single-stat threshold | Ticket only |

### Why two severities

Things that mean "operators cannot use the system" should page. Things that mean "the system is degraded but operators are unaffected" should not — they should generate tickets the on-call reviews during business hours. Mixing the two trains people to ignore the pager.

---

## Configuration

### Environment-Specific Overrides

Grafana dashboards committed to source control should be portable across dev, staging, and production:

1. **Variables**: Each dashboard declares a `$node` variable resolved from the data source, so the dashboard works against any node.
2. **Annotations**: Backend deployments emit annotations (e.g. via `/api/annotations`) so dashboards show when a new backend version was released.
3. **Folders**: Group dashboards by audience (Operations, Engineering, Demo).

### Default Refresh and Time Range

| Setting | Default |
|---------|---------|
| Time range | Last 1 hour |
| Refresh | 30 seconds |
| Min refresh interval | 10 seconds |
| Timezone | UTC |

UTC matters: most users will be in different timezones, and consistent timestamps in panels make incident timelines easier to reconstruct.

---

## Security Considerations

### Current Implementation

- The Grafana → backend connection rides the reverse SSH tunnel. Encrypted in transit, authenticated by ed25519 key.
- The backend itself does not authenticate Grafana — anything reaching `localhost:8000` on the node is trusted. The trust boundary is the SSH `permitopen` restriction, not the backend.
- Grafana's own auth (whatever it's configured with on the node) controls who can see the dashboards.

### Trade-offs

- The backend is treated as a trusted internal service to anyone who can hit `localhost:8000` on the node. A second user on the node could also query it. For most deployments this is acceptable because the node is single-tenant.
- Grafana's saved queries include raw URLs and any auth headers. Don't embed secrets in panel queries.

### Recommendations for Production

1. **Grafana auth via SSO** (OAuth / OIDC) instead of local users.
2. **Read-only Grafana role** for dashboard viewers. Reserve edit for a small group.
3. **Annotation provenance** — set the user who created the annotation so deploy events are traceable.
4. **Backend rate limiting** — even though Grafana is the only client, a misconfigured panel can hammer it. Add a per-endpoint rate limit in the backend.
5. **Dashboard JSON in source control** — store the dashboards as JSON in this repo so changes are reviewable and rollbacks are possible.

---

## Performance Considerations

### Bottlenecks

1. **SSH RTT** between the node and the docker host. Dominates panel latency for low-volume queries.
2. **Backend response time** for expensive endpoints. Don't put long-running queries in fast-refresh panels.
3. **Grafana itself** under high dashboard count. The node's Grafana may need more RAM if dozens of dashboards refresh in parallel.

### Optimizations

1. **Cache friendly endpoints in the backend.** A `/status` endpoint that returns a 1-second-stale snapshot is much cheaper than one that recomputes on every call.
2. **Reduce panel count on Overview.** Fewer panels per dashboard = fewer concurrent backend hits per refresh.
3. **Stagger refresh intervals.** Multiples of 30s, not all on the same boundary, smooth the load.
4. **Use Grafana's `transformations`** to reshape data client-side rather than building a new backend endpoint per panel.

### Future Enhancements

1. **Push-based metrics** (Prometheus pushgateway, or backend → Grafana Loki) for high-cardinality counters that don't fit a polling model.
2. **Pre-aggregation in the backend** for dashboards that need rolling windows.
3. **Anomaly detection panels** once enough history exists.

---

## Testing

### Manual Testing Checklist

1. **Connectivity**:
   - Grafana data source test goes green
   - Each dashboard loads without "no data" placeholders
   - Time-series panels show non-flat data over the last hour

2. **Dashboards**:
   - Overview opens in under 3 seconds
   - All four dashboards load without errors
   - Variable selectors (e.g. `$node`) populate correctly
   - Drilldown links between dashboards work

3. **Alerts**:
   - Stop the backend → liveness alert fires within 1 minute
   - Restart the backend → alert clears within 2 minutes
   - Generate synthetic 5xx → error rate alert fires
   - Restart the tunnel → reconnect-storm alert does not falsely fire on a single reconnect

4. **Failure modes**:
   - Stop the sidecar → all dashboards show "no data" within one refresh cycle
   - Stop a specific AnyLog node → only the panels referencing that node show issues; others stay green
   - Block port 22 from the docker host briefly → tunnel reconnects and dashboards recover automatically

---

## Troubleshooting

### Common Issues

1. **All dashboards show "no data"**
   - The tunnel is down. Check `docker logs backend-tunnel` and see [`DOCKER_TUNNEL_SETUP.md`](./DOCKER_TUNNEL_SETUP.md)
   - The backend is down. Check `docker logs remote-gui`

2. **One dashboard shows "no data", others are fine**
   - The data source URL changed. Verify in Grafana: Connections → Data sources
   - The endpoint that dashboard relies on was renamed. Check the backend's recent commits.

3. **Panels render but values are stale**
   - The panel's refresh interval is too long
   - The backend endpoint is returning cached data — check any `Cache-Control` headers in the response

4. **Alert flaps on every refresh**
   - The threshold is too aggressive
   - The "for" duration is too short — increase it so the alert needs sustained badness, not a single bad sample

5. **Dashboard load takes more than 5 seconds**
   - Too many panels refreshing in parallel — stagger the intervals
   - One specific panel's backend endpoint is slow — diagnose it in the Query Activity dashboard

---

## Future Enhancements

1. **Loki integration** to ship the backend's structured logs to the node, so dashboards can correlate panels with log lines from the same time window.
2. **Tempo / OpenTelemetry traces** for end-to-end request tracing, especially across the backend → AnyLog node hop.
3. **Synthetic checks** — Grafana running scripted queries against the backend on a schedule, separate from any specific dashboard.
4. **Mobile-friendly Overview** dashboard for on-call operators looking at the system from their phone.
5. **Dashboard CI** — validate dashboard JSON in PRs so broken dashboards don't reach production.
6. **Public status page** sourced from the Overview's liveness panel, so end users can see "the system is healthy" without Grafana access.

---

## API Reference Summary

| Endpoint | Method | Purpose | Auth Required |
|----------|--------|---------|---------------|
| `/monitoring/grafana` | GET | Monitored network rows for Grafana panels (filterable by node) | No |
| `/monitoring/nodes` | GET | List of monitored node names for variable population | No |
| `/` (backend root) | GET | Liveness probe consumed by the Overview dashboard | No |

---

## Dependencies

### Required

- **Grafana 9.x+** on the AnyLog node, with the **Infinity** plugin installed
- **Reverse SSH tunnel** from the docker host to the node (see [`DOCKER_TUNNEL_SETUP.md`](./DOCKER_TUNNEL_SETUP.md))
- **FastAPI backend** in the `remote-gui` container, listening on container port `8000`

### Optional

- **Loki** for log shipping
- **Tempo** for tracing
- **Grafana Alerting integrations** (PagerDuty, Slack, Opsgenie) for notifications

---

## Conclusion

The monitoring layer turns the Remote-GUI deployment from a black box into a system that operators can see into. Grafana, running on the AnyLog node, queries the FastAPI backend over a reverse SSH tunnel and renders a small set of dashboards covering liveness, node health, query activity, and plugin state. No code in the backend was changed to make this work — the same endpoints that serve the React frontend serve Grafana. The result is observability with minimal added surface area: one sidecar container, one data source, four dashboards.
