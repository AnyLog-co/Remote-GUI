# MCP Client Backend

This backend package provides the FastAPI routes and agent implementation for the MCP Client plugin.

The canonical plugin README lives with the frontend plugin page:

```text
CLI/local-cli-fe-full/src/plugins/mcpclient/README.md
```

That README documents the complete current behavior, including:

- AnyLog MCP SSE connection selection.
- Ollama, LM Studio, and OpenAI-compatible LLM endpoints.
- Per-chat configuration.
- MCP tool caching and observation logs.
- Streaming output.
- Background stream jobs and reconnect/resume behavior.
- Canceling long-running stream jobs.
- PDF export.
- Generated HTML/CSS/JavaScript rendering and downloads.
- Common failure modes and fixes.
- Development verification commands.

Backend files:

- `mcpclient_router.py`: FastAPI router, connection routes, model listing, resumable stream job registry, cancellation endpoint.
- `mcp_agent.py`: MCP client process, tool conversion, model calls, tool-loop orchestration, compatibility handling for local models.
- `__init__.py`: plugin package entrypoint.

Quick verification from the repo root:

```bash
python3 -m py_compile CLI/local-cli-backend/plugins/mcpclient/mcp_agent.py CLI/local-cli-backend/plugins/mcpclient/mcpclient_router.py
```

Backend changes require restarting the backend server before the UI can use them.
