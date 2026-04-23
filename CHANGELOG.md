---
title: Changelog
description: Release history and notable changes for the AnyLog Remote GUI.
layout: page
---
<!--
## Changelog
- 2026-04-23 | Created document
-->

<!-- last-processed: 4d9b34a139aa54ad764b0f4653d7d784fb682a71 -->

The Remote GUI is a browser-based interface for interacting with AnyLog networks — querying data, managing policies, monitoring nodes, and exploring the Unified Namespace. Version 1.0.0 marks the first stable production release of the rewritten GUI.

---

## Unreleased

<!-- Developers: add bullets below as changes land in your branch -->

---

## 1.0.0 (April 2026)

The first stable production release. The GUI has been in active use internally since early 2026 and this release formalizes the feature set that has been running in production.

### ✨ New Features
- **UNS live reporting** — real-time data display within the Unified Namespace view
- **Custom policy creator** — fully custom policy builder with UNS policy template support
- **Blockchain ID search** — search policies by ID in the blockchain manager
- **FRONTEND_URL CORS enforcement** — configurable env var to restrict backend access to the frontend origin, blocking bots and scanners via TrustedHost middleware
- **Node picker editing** — edit node connection details directly from the node picker dropdown
- **Env vars in About section** — runtime environment variables now visible in the About panel
- **GET data nodes in UNS** — UNS panel now shows available data nodes

### 🐛 Bug Fixes
- Fixed period function `AND` separator — queries now correctly include `and` before `period()` in the WHERE clause (AB-117)
- Fixed timezone query parameter handling (AB-114)
- Fixed `and` placement before timezone in SQL queries
- Fixed background node connectivity checking — now non-blocking
- Improved error message when backend is not reachable

### 🔧 Improvements
- Version control tooling added — version number tracked in `setup.cfg` and surfaced in the About section
- Docker image security score improved
- Node removal moved from standalone button into the connections dropdown menu

---

## Pre-1.0.0

### Phase 3 — SSH, Video, and Vite (February – March 2026)

The GUI gained its third major plugin: a full SSH CLI terminal allowing direct shell access to AnyLog nodes from within the browser. Video streaming support was merged in. The frontend build system was migrated from Create React App to **Vite** for significantly faster builds and dev server. Credential management was hardened with encryption and a persistent credential store.

**Highlights:**
- SSH CLI plugin — password and SSH key authentication, multi-terminal view, connection/terminal resizing, parallel sessions to same host
- Credential manager — encrypted storage with Dexie, in-memory key handling
- Video streaming tab — live stream viewer, embedded grid player
- Vite migration — replaced Create React App, updated all env var references from `REACT_APP_*` to `VITE_*`
- Raw text output toggle for commands with complex output (e.g. `get msg client`)
- CSV and PDF export from client dashboard and UNS views
- Connection starring/bookmarking improvements
- SSH client pulls selected node from the main dashboard node picker
- Table auto-resizing on the main dashboard
- Configurable request timeouts via `docker-compose.yaml`
- Backend and frontend Docker node naming fixed (was previously hardcoded)

---

### Phase 2 — Plugin System and UNS (October 2025 – January 2026)

The plugin architecture was completed and the Unified Namespace became a first-class feature. The plugin system allows new capabilities to be added and toggled via `feature_config.json` without modifying the core application. UNS, Grafana, Report Generator, and MCP Client all shipped as plugins during this phase.

**Highlights:**
- **Plugin system** — dynamic plugin loading in frontend; feature enable/disable via config file
- **UNS filesystem plugin** — hierarchical namespace browser with breadcrumb navigation, hover info, SQL querying from within the namespace tree, configurable root
- **MCP Client plugin** — chatbot with markdown rendering, Ollama integration, PDF export of chat history
- **Grafana plugin** — embedded Grafana dashboards with iframe embedding fix
- **Report Generator plugin** — PDF report generation from query results, import/export of report config files
- Blob streaming — streaming blob viewer and grid player
- Blockchain manager — policy editing, general policy parsing improvements, signing with chosen user
- SQL query builder improvements — `GROUP BY`, `ORDER BY`, increments, periods, aggregations, stats panel, bookmarking queries
- Bookmarks — save and reuse queries, default from bookmarks on load
- Command info / code section — Windows and Unix curl command display
- Monitoring additions — node status, execution time on client dashboard
- Windows curl command support in command info modal

---

### Phase 1 — Student Rebuild (January – July 2025)

The GUI was rebuilt from scratch by a student group as a React + FastAPI application. The group established the core architecture, authentication flow, main dashboard, monitoring view, policy manager, blob browser, and preset/bookmark system. Pranav joined in August 2025 and took the project over from the student team.

**Highlights:**
- React + FastAPI foundation with Docker deployment
- User authentication (login/signup) — later simplified to userless file-based auth
- Main dashboard with node connectivity, monitoring, and status
- Policy manager — create, push, and manage blockchain policies
- Blob browser — view and select blob files
- Preset manager — save, import, export query presets; Supabase integration (later replaced with file-based)
- AnyLog API and `run client ()` support
- SQL query builder foundation — aggregations, periods, increments, WHERE clause
- ARM/AMD unified Docker build
- Repo cleanup — removed Local-CLI folder, consolidated directory structure

---

*For the full commit-level history, run `git log` or browse the repository on GitHub.*