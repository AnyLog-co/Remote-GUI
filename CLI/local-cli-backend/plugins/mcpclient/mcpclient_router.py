"""
MCP Client Plugin Router
Integrates Ollama with AnyLog MCP for AI-powered maintenance copilot
"""
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional, List, Dict
from urllib.parse import urlparse
import os
import asyncio
import json


def _is_valid_ollama_endpoint(url: str) -> bool:
    """Validate that a string looks like a reachable Ollama endpoint URL."""
    try:
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https"):
            return False
        if not parsed.hostname:
            return False
        # Must have a port or be a full hostname (not a partial IP like "192.168.")
        host = parsed.hostname
        if host.endswith(".") or host.startswith("."):
            return False
        # Reject obviously incomplete IPs like "192.168" or "192.168.210"
        parts = host.split(".")
        if all(p.isdigit() for p in parts):
            if len(parts) != 4:
                return False
            if any(int(p) > 255 for p in parts):
                return False
        return True
    except Exception:
        return False


def _is_valid_mcp_sse_url(url: str) -> bool:
    """Validate that a string looks like an MCP SSE URL."""
    try:
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https"):
            return False
        if not parsed.hostname:
            return False
        if parsed.hostname.endswith(".") or parsed.hostname.startswith("."):
            return False
        return True
    except Exception:
        return False

# Create the API router
api_router = APIRouter(prefix="/mcpclient", tags=["MCP Client"])

# Try to import MCP agent
HAS_MCP_AGENT = False
try:
    from .mcp_agent import (
        AnyLogMCPAgent,
        HAS_OLLAMA,
        HAS_MCP,
        DEFAULT_ANYLOG_MCP_SSE_URL,
        DEFAULT_OLLAMA_MODEL,
        DEFAULT_LLM_API_TYPE,
        normalize_llm_api_type,
    )
    HAS_MCP_AGENT = True
    print("✅ Successfully imported MCP agent")
except (ImportError, ValueError, json.JSONDecodeError) as e:
    # Catch ImportError, ValueError (which includes JSONDecodeError), and JSONDecodeError explicitly
    error_msg = str(e)
    if "Expecting value" in error_msg or "JSON" in error_msg or isinstance(e, json.JSONDecodeError):
        print(f"⚠️  Could not import MCP agent (JSON parsing error): {e}")
        print("   This might be due to a configuration issue or dependency problem")
    else:
        print(f"⚠️  Could not import MCP agent: {e}")
        print("   This usually means missing dependencies: ollama, mcp")
    # Create dummy class for error handling
    class AnyLogMCPAgent:
        def __init__(self, *args, **kwargs):
            raise RuntimeError("MCP agent not available - missing dependencies")
except Exception as e:
    # Catch any other unexpected errors during import
    print(f"⚠️  Unexpected error importing MCP agent: {e}")
    print(f"   Error type: {type(e).__name__}")
    import traceback
    print(f"   Traceback: {traceback.format_exc()}")
    # Create dummy class for error handling
    class AnyLogMCPAgent:
        def __init__(self, *args, **kwargs):
            raise RuntimeError("MCP agent not available - import failed")

# Request/Response models
class MCPConnectRequest(BaseModel):
    anylog_sse_url: Optional[str] = None
    ollama_model: Optional[str] = None
    llm_endpoint: Optional[str] = None  # Ollama endpoint (e.g., "http://localhost:11434")
    llm_api_type: Optional[str] = None  # auto, ollama, or openai

class MCPAskRequest(BaseModel):
    prompt: str
    anylog_sse_url: Optional[str] = None
    ollama_model: Optional[str] = None
    llm_endpoint: Optional[str] = None  # Ollama endpoint (e.g., "http://localhost:11434")
    llm_api_type: Optional[str] = None  # auto, ollama, or openai
    conversation_history: Optional[List[Dict[str, str]]] = None  # List of {role: "user"|"assistant", content: "..."}

class MCPStatusResponse(BaseModel):
    connected: bool
    available_tools: List[str]
    ollama_available: bool
    mcp_available: bool
    ollama_reachable: Optional[bool] = None
    current_model: Optional[str] = None
    anylog_url: Optional[str] = None
    llm_endpoint: Optional[str] = None  # Custom Ollama endpoint if configured
    llm_api_type: Optional[str] = None

# Global agent instance (per-request would be better, but for simplicity we'll use one)
_agent_instance: Optional[AnyLogMCPAgent] = None
_agent_lock = asyncio.Lock()
_connecting = False  # Flag to prevent concurrent connection attempts

async def get_or_create_agent(
    anylog_sse_url: Optional[str] = None,
    ollama_model: Optional[str] = None,
    llm_endpoint: Optional[str] = None,
    llm_api_type: Optional[str] = None
) -> AnyLogMCPAgent:
    """Get or create a global agent instance with connection reuse"""
    global _agent_instance, _connecting
    
    async with _agent_lock:
        url = anylog_sse_url or os.getenv("ANYLOG_MCP_SSE_URL", DEFAULT_ANYLOG_MCP_SSE_URL)
        model = ollama_model or os.getenv("OLLAMA_MODEL", DEFAULT_OLLAMA_MODEL)
        # Normalize endpoint: empty string, None, or whitespace-only all mean local Ollama
        endpoint = llm_endpoint.strip() if llm_endpoint and llm_endpoint.strip() else None
        if not endpoint:
            endpoint = os.getenv("LLM_ENDPOINT", None)
            if endpoint:
                endpoint = endpoint.strip() if endpoint.strip() else None
        api_type = normalize_llm_api_type(llm_api_type or os.getenv("LLM_API_TYPE", DEFAULT_LLM_API_TYPE))

        if not url or not _is_valid_mcp_sse_url(url):
            raise RuntimeError("A valid AnyLog MCP SSE URL is required. Select a query node or enter an MCP URL.")
        
        # Reuse existing connection if URL, model, and endpoint match
        if _agent_instance is not None:
            # Normalize existing endpoint for comparison
            existing_endpoint = _agent_instance.llm_endpoint.strip() if _agent_instance.llm_endpoint and _agent_instance.llm_endpoint.strip() else None
            existing_api_type = getattr(_agent_instance, "llm_api_type", "auto")
            
            if (_agent_instance.anylog_sse_url == url and 
                _agent_instance.ollama_model == model and
                existing_endpoint == endpoint and
                existing_api_type == api_type and
                _agent_instance.session is not None):
                # Verify it's still alive
                if await _agent_instance.health_check():
                    return _agent_instance
                else:
                    # Connection is dead, clean it up
                    try:
                        await asyncio.wait_for(_agent_instance.close(), timeout=5.0)
                    except Exception:
                        pass
                    _agent_instance = None
            else:
                # Model, URL, or endpoint changed - close old agent and create new one
                print(f"🔄 Model/URL/Endpoint/API changed. Old model: {_agent_instance.ollama_model}, New model: {model}. Closing old agent...")
                try:
                    await asyncio.wait_for(_agent_instance.close(), timeout=5.0)
                except Exception:
                    pass
                _agent_instance = None
        
        # Prevent concurrent connection attempts
        if _connecting:
            raise RuntimeError("Another connection attempt is in progress. Please wait.")
        
        _connecting = True
        try:
            print(f"🆕 Creating new agent with model: {model}, endpoint: {endpoint}, api_type: {api_type}")
            _agent_instance = AnyLogMCPAgent(
                anylog_sse_url=url,
                ollama_model=model,
                llm_endpoint=endpoint,
                llm_api_type=api_type
            )
            await _agent_instance.connect(timeout=10.0)
            return _agent_instance
        finally:
            _connecting = False

async def close_agent(timeout: float = 5.0):
    """Close the global agent instance with timeout"""
    global _agent_instance, _connecting
    async with _agent_lock:
        if _agent_instance is not None:
            try:
                await asyncio.wait_for(_agent_instance.close(), timeout=timeout)
            except asyncio.TimeoutError:
                # Force cleanup on timeout
                print("Warning: Connection close timed out, forcing cleanup")
                _agent_instance.session = None
                _agent_instance.stdio = None
                _agent_instance.write = None
                _agent_instance.exit_stack = None
                _agent_instance.cached_tools = []
                if hasattr(_agent_instance, "cached_ollama_tools"):
                    _agent_instance.cached_ollama_tools = []
            except Exception as e:
                print(f"Error closing agent: {e}")
            finally:
                _agent_instance = None
                _connecting = False

# API endpoints
@api_router.get("/")
async def mcpclient_info():
    """Get MCP client information"""
    return {
        "name": "MCP Client Plugin",
        "version": "1.0.0",
        "description": "Integrates Ollama with AnyLog MCP for AI-powered maintenance copilot",
        "ollama_available": HAS_OLLAMA,
        "mcp_available": HAS_MCP,
        "dependencies": {
            "ollama": HAS_OLLAMA,
            "mcp": HAS_MCP
        },
        "endpoints": [
            "/status - Get connection status",
            "/connect - Connect to AnyLog MCP",
            "/disconnect - Disconnect from AnyLog MCP",
            "/ask - Ask a question to the MCP agent",
            "/tools - List available MCP tools",
            "/models - List available models from Ollama"
        ]
    }

@api_router.get("/status")
async def get_status():
    """Get MCP client connection status (verifies connection is actually working)"""
    global _agent_instance
    
    if not HAS_MCP_AGENT:
        return MCPStatusResponse(
            connected=False,
            available_tools=[],
            ollama_available=HAS_OLLAMA,
            mcp_available=HAS_MCP,
            current_model=None,
            anylog_url=None,
            llm_api_type=None
        )
    
    if _agent_instance is None or _agent_instance.session is None:
        return MCPStatusResponse(
            connected=False,
            available_tools=[],
            ollama_available=HAS_OLLAMA,
            mcp_available=HAS_MCP,
            current_model=_agent_instance.ollama_model if _agent_instance else None,
            anylog_url=_agent_instance.anylog_sse_url if _agent_instance else None,
            llm_endpoint=_agent_instance.llm_endpoint if _agent_instance else None,
            llm_api_type=getattr(_agent_instance, "llm_api_type", None) if _agent_instance else None
        )
    
    # Verify connection is actually working with a health check
    is_alive = await _agent_instance.health_check()
    
    if not is_alive:
        # Connection is dead, clean up
        try:
            await close_agent()
        except Exception:
            pass
        return MCPStatusResponse(
            connected=False,
            available_tools=[],
            ollama_available=HAS_OLLAMA,
            mcp_available=HAS_MCP,
            current_model=_agent_instance.ollama_model if _agent_instance else None,
            anylog_url=_agent_instance.anylog_sse_url if _agent_instance else None,
            llm_endpoint=_agent_instance.llm_endpoint if _agent_instance else None,
            llm_api_type=getattr(_agent_instance, "llm_api_type", None) if _agent_instance else None
        )
    
    # Connection is alive, use cached tools
    return MCPStatusResponse(
        connected=True,
        available_tools=_agent_instance.cached_tools,
        ollama_available=HAS_OLLAMA,
        mcp_available=HAS_MCP,
        current_model=_agent_instance.ollama_model,
        anylog_url=_agent_instance.anylog_sse_url,
        llm_endpoint=_agent_instance.llm_endpoint,
        llm_api_type=getattr(_agent_instance, "llm_api_type", "auto")
    )

@api_router.post("/connect")
async def connect_mcp(request: MCPConnectRequest):
    """Connect to AnyLog MCP server with connection reuse"""
    if not HAS_MCP_AGENT:
        raise HTTPException(
            status_code=500,
            detail="MCP agent not available. Please install required dependencies: ollama, mcp"
        )
    
    try:
        global _agent_instance
        
        url = request.anylog_sse_url or os.getenv("ANYLOG_MCP_SSE_URL", DEFAULT_ANYLOG_MCP_SSE_URL)
        model = request.ollama_model or os.getenv("OLLAMA_MODEL", DEFAULT_OLLAMA_MODEL)
        # Normalize endpoint: empty string, None, or whitespace-only all mean local Ollama
        endpoint = request.llm_endpoint.strip() if request.llm_endpoint and request.llm_endpoint.strip() else None
        if not endpoint:
            endpoint = os.getenv("LLM_ENDPOINT", None)
            if endpoint:
                endpoint = endpoint.strip() if endpoint.strip() else None
        api_type = normalize_llm_api_type(request.llm_api_type or os.getenv("LLM_API_TYPE", DEFAULT_LLM_API_TYPE))
        
        if endpoint and not _is_valid_ollama_endpoint(endpoint):
            raise HTTPException(
                status_code=400,
                detail=f"Invalid LLM endpoint URL: '{endpoint}'. Please provide a complete URL like http://host:port"
            )
        if not url or not _is_valid_mcp_sse_url(url):
            raise HTTPException(
                status_code=400,
                detail="A valid AnyLog MCP SSE URL is required. Select a query node in the header or enter an MCP URL."
            )
        
        # Check if we can reuse existing connection
        async with _agent_lock:
            if _agent_instance is not None:
                # Normalize existing endpoint for comparison
                existing_endpoint = _agent_instance.llm_endpoint.strip() if _agent_instance.llm_endpoint and _agent_instance.llm_endpoint.strip() else None
                existing_api_type = getattr(_agent_instance, "llm_api_type", "auto")
                
                if (_agent_instance.anylog_sse_url == url and 
                    _agent_instance.ollama_model == model and
                    existing_endpoint == endpoint and
                    existing_api_type == api_type and
                    _agent_instance.session is not None):
                    # Verify it's still alive
                    if await _agent_instance.health_check():
                        return {
                            "success": True,
                            "message": "Reusing existing connection to AnyLog MCP",
                            "available_tools": _agent_instance.cached_tools,
                            "ollama_model": model,
                            "anylog_url": url,
                            "llm_endpoint": endpoint,
                            "llm_api_type": api_type
                        }
                    else:
                        # Connection is dead, clean it up
                        try:
                            await asyncio.wait_for(_agent_instance.close(), timeout=5.0)
                        except Exception:
                            pass
                        _agent_instance = None
        
        # Close existing connection if URL/model/endpoint changed
        if _agent_instance is not None:
            # Normalize existing endpoint for comparison
            existing_endpoint = _agent_instance.llm_endpoint.strip() if _agent_instance.llm_endpoint and _agent_instance.llm_endpoint.strip() else None
            existing_api_type = getattr(_agent_instance, "llm_api_type", "auto")
            
            if (_agent_instance.anylog_sse_url != url or 
                _agent_instance.ollama_model != model or
                existing_endpoint != endpoint or
                existing_api_type != api_type):
                await close_agent()
        
        # Create new connection (or reuse if same URL/model/endpoint)
        agent = await get_or_create_agent(url, model, endpoint, api_type)
        tools = agent.cached_tools
        
        return {
            "success": True,
            "message": "Connected to AnyLog MCP",
            "available_tools": tools,
            "ollama_model": model,
            "anylog_url": url,
            "llm_endpoint": endpoint,
            "llm_api_type": api_type
        }
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        error_detail = str(e)
        error_lower = error_detail.lower()
        # Add more context for common errors
        if "mcp-proxy" in error_lower or "command not found" in error_lower:
            error_detail = f"mcp-proxy not found. Please ensure mcp-proxy is installed and in your PATH. Original error: {error_detail}"
        elif "all connection attempts failed" in error_lower or "connecterror" in error_lower:
            error_detail = (
                f"Cannot reach AnyLog MCP server at {url}. "
                "This page now defaults to the selected query node in the header; "
                "verify that node exposes the MCP SSE endpoint at /mcp/sse, or enter a different MCP URL. "
                f"Original error: {error_detail}"
            )
        elif "connection" in error_lower and "closed" in error_lower:
            error_detail = f"Connection to AnyLog MCP server failed. Please check if the server is running at {url}. Original error: {error_detail}"
        elif "ConnectionError" in str(type(e)):
            error_detail = f"Cannot reach AnyLog MCP server at {url}. Please verify the URL and that the server is accessible. Original error: {error_detail}"
        
        print(f"❌ MCP Connection Error: {error_detail}")
        print(f"   Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=error_detail)

@api_router.post("/disconnect")
async def disconnect_mcp():
    """Disconnect from AnyLog MCP server"""
    try:
        await close_agent()
        return {
            "success": True,
            "message": "Disconnected from AnyLog MCP"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to disconnect: {str(e)}")

@api_router.get("/models")
async def list_models(llm_endpoint: Optional[str] = None, llm_api_type: Optional[str] = None):
    """List available models from local Ollama, Ollama HTTP, or OpenAI-compatible endpoints."""
    if not HAS_MCP_AGENT:
        raise HTTPException(
            status_code=500,
            detail="MCP agent not available. Please install required dependencies: ollama, mcp"
        )
    
    endpoint = llm_endpoint or os.getenv("LLM_ENDPOINT", None)
    api_type = normalize_llm_api_type(llm_api_type or os.getenv("LLM_API_TYPE", DEFAULT_LLM_API_TYPE))
    
    if endpoint and not _is_valid_ollama_endpoint(endpoint):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid LLM endpoint URL: '{endpoint}'. Please provide a complete URL like http://host:port"
        )
    
    try:
        if endpoint:
            from .mcp_agent import list_models_from_endpoint
            result = await list_models_from_endpoint(endpoint, api_type, timeout=10.0)
            models = result["models"]
            source = result["source"]
        else:
            # List models from local Ollama
            from .mcp_agent import list_models_from_local_ollama
            models = await list_models_from_local_ollama(timeout=10.0)
            source = "local"
        
        # Format response
        model_list = []
        print(f"🔍 Raw models from {source} (count: {len(models)}): {models}")
        for idx, model in enumerate(models):
            # Try multiple ways to get the model name
            if isinstance(model, dict):
                model_name = model.get("name") or model.get("model") or model.get("model_name") or ""
                print(f"🔍 Model {idx} (dict): keys={list(model.keys())}, name={model.get('name')}, model={model.get('model')}")
            else:
                model_name = getattr(model, "name", None) or getattr(model, "model", None) or getattr(model, "model_name", None) or ""
                print(f"🔍 Model {idx} (object): name={getattr(model, 'name', None)}, model={getattr(model, 'model', None)}")
            
            if not model_name:
                print(f"⚠️  Warning: Model {idx} has no name field. Model object: {model}")
                continue  # Skip models without names
            
            print(f"✅ Extracted model name: {model_name}")
            model_list.append({
                "name": model_name,
                "model": model_name,
                "size": model.get("size", 0) if isinstance(model, dict) else getattr(model, "size", 0),
                "modified_at": model.get("modified_at", "") if isinstance(model, dict) else getattr(model, "modified_at", ""),
                "details": model.get("details", {}) if isinstance(model, dict) else getattr(model, "details", {})
            })
        print(f"📋 Models returned to frontend: {[m['name'] for m in model_list]} (source: {source})")
        
        return {
            "success": True,
            "models": model_list,
            "count": len(model_list),
            "source": source,
            "endpoint": endpoint if endpoint else "local",
            "llm_api_type": api_type if endpoint else "ollama"
        }
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to list models: {str(e)}"
        )

@api_router.get("/tools")
async def list_tools():
    """List available MCP tools"""
    global _agent_instance
    
    if not HAS_MCP_AGENT:
        raise HTTPException(
            status_code=500,
            detail="MCP agent not available. Please install required dependencies: ollama, mcp"
        )
    
    if _agent_instance is None or _agent_instance.session is None:
        raise HTTPException(
            status_code=400,
            detail="Not connected. Please call /connect first."
        )
    
    try:
        # Use cached tool schemas if available, otherwise fetch fresh (with timeout).
        if getattr(_agent_instance, "cached_ollama_tools", None):
            tools = []
            for tool in _agent_instance.cached_ollama_tools:
                fn = tool.get("function", {})
                tools.append({
                    "name": fn.get("name", ""),
                    "description": fn.get("description", ""),
                    "inputSchema": fn.get("parameters", {})
                })
            return {
                "success": True,
                "tools": tools,
                "count": len(tools)
            }
        else:
            # No cached tools, fetch fresh with timeout
            tools_resp = await asyncio.wait_for(_agent_instance.session.list_tools(), timeout=5.0)
            tools = []
            for t in tools_resp.tools:
                tools.append({
                    "name": t.name,
                    "description": t.description or "",
                    "inputSchema": t.inputSchema or {}
                })
            # Update cache
            _agent_instance.cached_tools = [t.name for t in tools_resp.tools]
            if hasattr(_agent_instance, "cached_ollama_tools"):
                from .mcp_agent import mcp_tools_to_ollama_tools
                _agent_instance.cached_ollama_tools = mcp_tools_to_ollama_tools(tools_resp.tools)
            return {
                "success": True,
                "tools": tools,
                "count": len(tools)
            }
    except asyncio.TimeoutError:
        raise HTTPException(status_code=500, detail="Failed to list tools: Operation timed out after 5s")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list tools: {str(e)}")

@api_router.post("/ask")
async def ask_question(request: MCPAskRequest):
    """Ask a question to the MCP agent"""
    if not HAS_MCP_AGENT:
        raise HTTPException(
            status_code=500,
            detail="MCP agent not available. Please install required dependencies: ollama, mcp"
        )
    
    try:
        global _agent_instance
        
        # Get or create connection (with reuse logic)
        url = request.anylog_sse_url or os.getenv("ANYLOG_MCP_SSE_URL", DEFAULT_ANYLOG_MCP_SSE_URL)
        model = request.ollama_model or os.getenv("OLLAMA_MODEL", DEFAULT_OLLAMA_MODEL)
        # Normalize endpoint: empty string, None, or whitespace-only all mean local Ollama
        endpoint = request.llm_endpoint.strip() if request.llm_endpoint and request.llm_endpoint.strip() else None
        if not endpoint:
            endpoint = os.getenv("LLM_ENDPOINT", None)
            if endpoint:
                endpoint = endpoint.strip() if endpoint.strip() else None
        api_type = normalize_llm_api_type(request.llm_api_type or os.getenv("LLM_API_TYPE", DEFAULT_LLM_API_TYPE))
        if endpoint and not _is_valid_ollama_endpoint(endpoint):
            raise HTTPException(
                status_code=400,
                detail=f"Invalid LLM endpoint URL: '{endpoint}'. Please provide a complete URL like http://host:port"
            )
        if not url or not _is_valid_mcp_sse_url(url):
            raise HTTPException(
                status_code=400,
                detail="A valid AnyLog MCP SSE URL is required. Select a query node in the header or enter an MCP URL."
            )
        
        # Log which LLM we're using
        if endpoint:
            print(f"🌐 Using LLM endpoint: {endpoint} with model: {model}, api_type: {api_type}")
        else:
            print(f"💻 Using local Ollama with model: {model}")
        
        agent = await get_or_create_agent(url, model, endpoint, api_type)
        
        # Ask the question (with timeout and conversation history)
        print(f"📝 MCP Ask Request - Prompt: {request.prompt[:100]}...")
        print(f"📝 Conversation history length: {len(request.conversation_history) if request.conversation_history else 0}")
        
        # Increased timeout to 5 minutes (300s) to handle complex queries with multiple tool calls
        answer = await agent.ask(
            request.prompt, 
            conversation_history=request.conversation_history,
            timeout=300.0  # 5 minutes (increased from 120s)
        )
        
        print(f"✅ MCP Ask Response - Answer length: {len(answer) if answer else 0}")
        print(f"✅ MCP Ask Response - Answer preview: {answer[:200] if answer else 'None'}...")
        
        response = {
            "success": True,
            "answer": answer,
            "prompt": request.prompt
        }
        
        print(f"✅ Returning response with answer field: {bool(response.get('answer'))}")
        return response
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print(f"❌ MCP Ask Error: {str(e)}")
        print(f"   Traceback: {traceback.format_exc()}")
        # If connection error, mark as disconnected
        error_str = str(e).lower()
        if "connection" in error_str or "closed" in error_str or "not connected" in error_str:
            try:
                await close_agent()
            except Exception:
                pass
        raise HTTPException(status_code=500, detail=f"Failed to process question: {str(e)}")


def _sse_event(event_type: str, **payload):
    data = {"type": event_type, **payload}
    return f"data: {json.dumps(data, default=str)}\n\n"


@api_router.post("/ask-stream")
async def ask_question_stream(request: MCPAskRequest):
    """Ask a question and stream progress plus answer chunks as server-sent events."""
    if not HAS_MCP_AGENT:
        raise HTTPException(
            status_code=500,
            detail="MCP agent not available. Please install required dependencies: ollama, mcp"
        )

    async def event_generator():
        agent = None
        try:
            url = request.anylog_sse_url or os.getenv("ANYLOG_MCP_SSE_URL", DEFAULT_ANYLOG_MCP_SSE_URL)
            model = request.ollama_model or os.getenv("OLLAMA_MODEL", DEFAULT_OLLAMA_MODEL)
            endpoint = request.llm_endpoint.strip() if request.llm_endpoint and request.llm_endpoint.strip() else None
            if not endpoint:
                endpoint = os.getenv("LLM_ENDPOINT", None)
                if endpoint:
                    endpoint = endpoint.strip() if endpoint.strip() else None
            api_type = normalize_llm_api_type(request.llm_api_type or os.getenv("LLM_API_TYPE", DEFAULT_LLM_API_TYPE))

            if endpoint and not _is_valid_ollama_endpoint(endpoint):
                yield _sse_event(
                    "error",
                    message=f"Invalid LLM endpoint URL: '{endpoint}'. Please provide a complete URL like http://host:port"
                )
                return
            if not url or not _is_valid_mcp_sse_url(url):
                yield _sse_event(
                    "error",
                    message="A valid AnyLog MCP SSE URL is required. Select a query node in the header or enter an MCP URL."
                )
                return

            yield _sse_event("status", message=f"Connecting to MCP with {model}")
            agent = AnyLogMCPAgent(
                anylog_sse_url=url,
                ollama_model=model,
                llm_endpoint=endpoint,
                llm_api_type=api_type
            )
            await agent.connect(timeout=10.0)
            yield _sse_event("status", message=f"Loaded {len(agent.cached_tools)} MCP tools")
            yield _sse_event("tools", tools=agent.cached_tools)

            event_queue = asyncio.Queue()
            command_start = asyncio.get_event_loop().time()

            async def emit_agent_event(event: Dict):
                await event_queue.put(event)

            async def run_agent():
                return await agent.ask(
                    request.prompt,
                    conversation_history=request.conversation_history,
                    timeout=300.0,
                    event_callback=emit_agent_event
                )

            yield _sse_event("command_start", started_at_ms=int(command_start * 1000))
            answer_task = asyncio.create_task(run_agent())

            while not answer_task.done() or not event_queue.empty():
                try:
                    event = await asyncio.wait_for(event_queue.get(), timeout=0.1)
                    event_type = event.get("type", "mcp_event")
                    payload = {key: value for key, value in event.items() if key != "type"}
                    yield _sse_event(event_type, **payload)
                except asyncio.TimeoutError:
                    continue

            answer = await answer_task
            total_elapsed_ms = int((asyncio.get_event_loop().time() - command_start) * 1000)

            chunk_size = 32
            for idx in range(0, len(answer), chunk_size):
                yield _sse_event("delta", content=answer[idx:idx + chunk_size])
                await asyncio.sleep(0.01)

            yield _sse_event("command_done", elapsed_ms=total_elapsed_ms)
            yield _sse_event("done", answer=answer, prompt=request.prompt, elapsed_ms=total_elapsed_ms)
        except Exception as e:
            error_str = str(e).lower()
            if "connection" in error_str or "closed" in error_str or "not connected" in error_str:
                try:
                    await close_agent()
                except Exception:
                    pass
            yield _sse_event("error", message=f"Failed to process question: {str(e)}")
        finally:
            if agent is not None:
                try:
                    await agent.close()
                except Exception:
                    pass

    return StreamingResponse(event_generator(), media_type="text/event-stream")

@api_router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket endpoint for streaming chat"""
    await websocket.accept()
    
    if not HAS_MCP_AGENT:
        await websocket.send_json({
            "type": "error",
            "message": "MCP agent not available. Please install required dependencies: ollama, mcp"
        })
        await websocket.close()
        return
    
    agent = None
    
    try:
        while True:
            data = await websocket.receive_json()
            
            if data.get("type") == "connect":
                # Connect to MCP
                url = data.get("anylog_sse_url") or os.getenv("ANYLOG_MCP_SSE_URL", DEFAULT_ANYLOG_MCP_SSE_URL)
                model = data.get("ollama_model") or os.getenv("OLLAMA_MODEL", DEFAULT_OLLAMA_MODEL)
                if not url or not _is_valid_mcp_sse_url(url):
                    await websocket.send_json({
                        "type": "error",
                        "message": "A valid AnyLog MCP SSE URL is required. Select a query node in the header or enter an MCP URL."
                    })
                    continue
                
                agent = AnyLogMCPAgent(anylog_sse_url=url, ollama_model=model)
                tools = await agent.connect()
                
                await websocket.send_json({
                    "type": "connected",
                    "tools": tools,
                    "model": model,
                    "url": url
                })
            
            elif data.get("type") == "ask":
                if agent is None or agent.session is None:
                    await websocket.send_json({
                        "type": "error",
                        "message": "Not connected. Send 'connect' message first."
                    })
                    continue
                
                prompt = data.get("prompt", "")
                if not prompt:
                    await websocket.send_json({
                        "type": "error",
                        "message": "Prompt is required"
                    })
                    continue
                
                # Ask the question
                answer = await agent.ask(prompt)
                
                await websocket.send_json({
                    "type": "answer",
                    "answer": answer,
                    "prompt": prompt
                })
            
            elif data.get("type") == "disconnect":
                if agent:
                    await agent.close()
                    agent = None
                await websocket.send_json({
                    "type": "disconnected"
                })
            
            else:
                await websocket.send_json({
                    "type": "error",
                    "message": f"Unknown message type: {data.get('type')}"
                })
    
    except WebSocketDisconnect:
        if agent:
            await agent.close()
    except Exception as e:
        await websocket.send_json({
            "type": "error",
            "message": str(e)
        })
        if agent:
            await agent.close()
