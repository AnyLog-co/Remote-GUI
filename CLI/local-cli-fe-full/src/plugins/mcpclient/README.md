# MCP Client Plugin

The MCP Client plugin is a chat-based UI for running a local or remote LLM against an AnyLog MCP server. It lets a user choose the MCP server, choose the LLM endpoint/model, send natural-language requests, observe MCP tool calls in real time, stream the assistant response, save multiple chats, and export or download useful output.

This README documents the current frontend plugin and the backend routes it depends on.

## Files

Frontend:

- `McpclientPage.js`: main React page, chat state, connection UI, observations, exports, artifacts.
- `mcpclient_api.js`: HTTP/SSE API client for the backend MCP routes.
- `MarkdownRenderer.js`: safe rendering for assistant markdown and generated content.

Backend:

- `CLI/local-cli-backend/plugins/mcpclient/mcpclient_router.py`: FastAPI routes, stream job registry, connection endpoints.
- `CLI/local-cli-backend/plugins/mcpclient/mcp_agent.py`: AnyLog MCP agent, LLM calls, tool-loop orchestration.

## User Features

- Per-chat MCP SSE URL.
- Per-chat LLM base URL.
- Per-chat optional API bearer token.
- Per-chat LLM API type: `auto`, `ollama`, or `openai`.
- Per-chat model selection based on the selected LLM base URL.
- Per-chat request timeout.
- Per-chat assistant name.
- Per-chat instructions that are prefixed to every user request.
- Multiple chats with persistence in browser storage.
- Rename and delete chats.
- Clear Browser Data also clears MCP client chat history.
- Streaming assistant output.
- Real-time MCP observation log under each assistant request.
- Running time for each MCP sub-request and the full command.
- Toggle/hide MCP observation logs.
- Error messages preserve the MCP observation log and show full exception details in a dropdown.
- Export chat to PDF.
- Render markdown, dashboards, and generated HTML/CSS/JavaScript output.
- Download generated code artifacts using the appropriate file extension.

## Connection Model

Each chat keeps its own connection configuration:

- `anylogUrl`: AnyLog MCP SSE URL, usually ending in `/mcp/sse`.
- `ollamaEndpoint`: LLM base URL. Despite the historical name, this can point to Ollama, LM Studio, or another OpenAI-compatible server.
- `llmBearerToken`: optional API bearer token for protected LLM endpoints. Blank by default.
- `llmApiType`: `auto`, `ollama`, or `openai`.
- `requestTimeoutSeconds`: total request timeout for this chat.
- `ollamaModel`: selected model name.
- `assistantName`: display name only.
- `instructions`: user-saved instruction text prefixed to each request.
- `mcpTools`: cached tool list for that chat.

The page defaults the MCP URL from the connected query node shown in the app header, but the user can override it.

## LLM Endpoint Behavior

### Ollama

Use `llmApiType = ollama` or `auto` with an Ollama-compatible endpoint.

Expected API:

- Model list: `GET /api/ps`
- Chat: `POST /api/chat`

Only running Ollama models are displayed. Installed but not currently loaded/running models are intentionally hidden so the UI does not default to a model that cannot answer.

### LM Studio / OpenAI-Compatible Servers

Use `llmApiType = openai` for LM Studio and OpenAI-compatible local servers.

Expected API:

- Model list: `GET /api/v0/models` for LM Studio first, with `GET /v1/models` as an OpenAI-compatible fallback.
- Chat: `POST /v1/chat/completions`

If the model server requires authentication, set the optional API Bearer Token field under the LLM base URL. The frontend sends the token to the backend for model listing and chat requests. When blank, no bearer token is provided.

This avoids sending LM Studio requests to Ollama routes like `/api/chat`, which can produce errors such as:

```text
Unexpected endpoint or method. (POST /api/chat)
```

The agent also has compatibility handling for models that do not accept native tool-call message structures. For those models, tool-call text is parsed from the assistant output, MCP tools are executed, and the tool results are sent back as user-visible context instead of native `tool` role messages.

## MCP Tool Handling

The backend caches MCP tools after connection and exposes them to the frontend. The UI shows the cached tools for the active chat instead of using one global tool list for every chat.

The agent should not need to ask MCP for `list_tools` on every request. It uses cached tools from the active MCP connection and refreshes them when a new MCP connection is created.

Supported observation events:

- `mcp_request`: tool call started.
- `mcp_response`: tool call completed.
- `mcp_error`: tool call failed.
- `command_start`: full command started.
- `command_done`: full command completed.
- `tools`: tool list loaded for this request/chat.

Each MCP observation includes:

- request id.
- tool name.
- arguments.
- response or error.
- full exception details when the backend can capture them.
- sub-request elapsed time.
- total command elapsed time at that point.

## Streaming And Reconnects

Long LLM + MCP runs can outlive the browser/SSE connection. The stream implementation is intentionally decoupled from the background operation.

Current behavior:

- The frontend sends a stable `stream_request_id` for each assistant response.
- The backend starts a background stream job for that id.
- The HTTP/SSE response only observes that job.
- If the browser disconnects, the backend job keeps running.
- The frontend reconnects up to 5 times.
- The backend replays stored events for the same `stream_request_id`.
- Events include sequence numbers, so duplicate replayed deltas are ignored.
- Heartbeat events keep long idle waits visible while work continues.
- Completed stream jobs are retained briefly, then cleaned up after the TTL.

This avoids LM Studio seeing a client disconnect and stopping generation during long-standing requests.

The Stop button is different from an accidental disconnect. It calls:

```text
POST /mcpclient/ask-stream/{stream_request_id}/cancel
```

That route cancels the background task and closes the active agent for that request.

## Request Timeouts

Long tool chains can spend time in:

- local prompt processing.
- model generation.
- repeated MCP tool calls.
- final report generation.

Each chat can customize the total request timeout in seconds. The default is 900 seconds, with backend clamping from 30 to 7200 seconds.

That budget is threaded into Ollama and OpenAI-compatible chat calls, including LM Studio, so long generations do not fail at the older 5-minute HTTP read timeout. Individual MCP tool calls still have their own internal timeout in the backend agent.

## Chat Persistence

Chat sessions are stored in browser local storage. Each chat stores:

- title.
- messages.
- connection config.
- optional API bearer token.
- request timeout.
- assistant name.
- instructions.
- cached MCP tools.
- updated timestamp.

Switching pages or chats should not erase the current chat. Deleting a chat removes only that chat. Clearing browser data from the app header clears the MCP client chat history as well.

## Instructions

The Instructions field is saved per chat. When present, the frontend wraps each user prompt like this:

```text
Instructions:
<saved instructions>

User request:
<user prompt>
```

This keeps the model behavior consistent across requests without requiring the user to retype context.

## Generated Output And Downloads

Assistant markdown is rendered in the chat. Code fences are inspected for artifact-like output.

For HTML/CSS/JavaScript output:

- The page can render generated HTML/dashboard output.
- Download buttons are shown for recognized code blocks.
- File extensions and MIME types are selected from the language tag when possible.

Use fenced code blocks with language tags for best results:

````markdown
```html
<!doctype html>
<html>...</html>
```

```css
body { ... }
```

```javascript
console.log("hello");
```
````

## PDF Export

The chat page supports exporting the current conversation to PDF. This is handled in the frontend and uses the rendered chat content.

Build note: `jspdf` is currently imported by this plugin and elsewhere in the frontend, so Vite may warn that the dynamic import will not move it to a separate chunk. That warning does not indicate a build failure.

## Backend Routes Used By The Frontend

- `GET /mcpclient/`: plugin metadata.
- `GET /mcpclient/status`: current backend MCP agent status.
- `POST /mcpclient/connect`: connect or reuse MCP/LLM configuration.
- `POST /mcpclient/disconnect`: close the shared MCP agent.
- `GET /mcpclient/models`: list models for the current LLM endpoint/API type.
- `GET /mcpclient/tools`: list cached MCP tools.
- `POST /mcpclient/ask`: non-streaming ask fallback.
- `POST /mcpclient/ask-stream`: streaming ask with resumable background job.
- `POST /mcpclient/ask-stream/{stream_request_id}/cancel`: cancel a background streaming ask.

## Common Failure Modes

### `name 'api_type' is not defined`

Cause: the connect route referenced `api_type` before initializing it.

Fix: `/mcpclient/connect` now normalizes `llm_api_type` before comparing or creating agents.

### LM Studio logs `Unexpected endpoint or method. (POST /api/chat)`

Cause: the UI/backend treated an LM Studio endpoint as Ollama.

Fix: choose `OpenAI / LM Studio` in the API type selector, which uses `/v1/chat/completions`.

### LM Studio logs `Client disconnected. Stopping generation...`

Cause: the browser/SSE connection dropped and the old backend generator closed the active agent.

Fix: streaming requests now run as background jobs and the SSE response observes the job. Accidental disconnects no longer cancel the operation.

### An assistant request fails and the MCP history disappears

Cause: older UI error handling replaced the in-flight assistant message with a new error object, dropping the MCP observation log.

Fix: error messages now preserve observations, open the MCP log by default, briefly display the error, and include a `Full exception` dropdown when the backend provides a traceback.

### Model appears in UI but is not running

Cause: older model listing used installed Ollama models.

Fix: Ollama model listing now uses running models only.

### Tool call markup appears in the final response

Cause: some local models emit text tool-call markers rather than native tool calls.

Fix: the agent strips parsed tool-call markup from user-visible assistant responses and includes tool usage in the observation/tool list instead.

## Development Commands

From the repo root:

```bash
python3 -m py_compile CLI/local-cli-backend/plugins/mcpclient/mcp_agent.py CLI/local-cli-backend/plugins/mcpclient/mcpclient_router.py
```

From the frontend directory:

```bash
npm run build
```

The frontend build may show Vite warnings about large chunks, `/config.js`, or `jspdf`; those are warnings, not test failures.

## Restart Requirements

Backend route and agent changes require restarting the backend server.

Frontend React/API client changes require rebuilding or restarting the frontend dev server, depending on how the app is being run.
