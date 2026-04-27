# (venv) ➜  Remote-GUI git:(bchain-optimz) ✗ uvicorn CLI.local-cli-backend.main:app --reload
import configparser
import os
import sys

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, 'static')
sys.path.append(BASE_DIR)

import logging
from logging_config import setup_logging
setup_logging()
logger = logging.getLogger("uvicorn.error")

from security.security_router import security_router

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import Dict

from parsers import parse_response
from classes import *
from sql_router import sql_router
from file_auth_router import file_auth_router
from file_auth import file_bookmark_node, file_set_default_bookmark
# Import plugin loader
from plugins.loader import load_plugins, get_plugin_order
# Import feature config loader
from feature_config_loader import (
    is_feature_enabled, 
    is_plugin_enabled,
    get_enabled_features,
    get_enabled_plugins,
    load_feature_config
)



# from helpers import make_request, grab_network_nodes, monitor_network, make_policy, send_json_data
from helpers import make_request, grab_network_nodes, monitor_network, make_policy, send_json_data, make_preset_policy
import helpers


app = FastAPI()

FRONTEND_URL = os.getenv('FRONTEND_URL', '')
ALLOWED_HOSTS = os.getenv('ALLOWED_HOSTS', '*')

cors_origins = [o.strip() for o in FRONTEND_URL.split(",") if o.strip()] if FRONTEND_URL else ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

if ALLOWED_HOSTS != '*':
    hosts = [h.strip() for h in ALLOWED_HOSTS.split(",") if h.strip()]
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=hosts)

SCANNER_PATHS = {
    "/json/", "/login", "/SDK/webLanguage", "/.env", "/wp-login.php",
    "/wp-admin", "/administrator", "/phpmyadmin", "/actuator", "/solr/",
    "/console", "/manager/html", "/cgi-bin/", "/.git", "/debug",
    "/telescope/requests", "/vendor/", "/api/v1/", "/config.json",
    "/remote/fgt_lang", "/boaform/", "/owa/auth/logon.aspx",
}


@app.middleware("http")
async def block_scanners_middleware(request: Request, call_next):
    """Reject common bot/scanner probe paths before they hit the app."""
    path = request.url.path.rstrip("/") if request.url.path != "/" else "/"
    for probe in SCANNER_PATHS:
        if path == probe.rstrip("/") or path.startswith(probe):
            logger.warning("Blocked scanner probe: %s from %s", request.url.path, request.client.host)
            return Response(status_code=404)
    return await call_next(request)

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# Load feature configuration
feature_config = load_feature_config()
print("📋 Feature Configuration Loaded:")
print(f"   Enabled features: {get_enabled_features()}")
print(f"   Enabled plugins: {get_enabled_plugins()}")

# Middleware to block disabled features
@app.middleware("http")
async def feature_check_middleware(request: Request, call_next):
    """Middleware to block access to disabled features"""
    path = request.url.path
    
    # Skip feature checks for static files, docs, config, and version endpoints
    if (path.startswith("/static/") or 
        path.startswith("/docs") or 
        path.startswith("/openapi.json") or
        path == "/" or
        path == "/version" or
        path == "/feature-config" or
        path == "/env-config"):
        response = await call_next(request)
        return response
    
    # Map URL paths to feature names
    feature_path_map = {
        "/sql": "sqlquery",
        "/auth": "bookmarks",  # file_auth_router handles both bookmarks and presets
        "/security": "security",
    }
    
    # Check if path matches a feature
    for prefix, feature_name in feature_path_map.items():
        if path.startswith(prefix):
            # Special handling for /auth endpoints
            if prefix == "/auth":
                # Check if it's a bookmark or preset endpoint
                if "bookmark" in path:
                    if not is_feature_enabled("bookmarks"):
                        return Response(
                            content='{"detail": "Feature \'bookmarks\' is disabled"}',
                            status_code=403,
                            media_type="application/json"
                        )
                elif "preset" in path:
                    if not is_feature_enabled("presets"):
                        return Response(
                            content='{"detail": "Feature \'presets\' is disabled"}',
                            status_code=403,
                            media_type="application/json"
                        )
                # If neither, allow if either is enabled (backward compatibility)
                elif not (is_feature_enabled("bookmarks") or is_feature_enabled("presets")):
                    return Response(
                        content='{"detail": "Feature is disabled"}',
                        status_code=403,
                        media_type="application/json"
                    )
            else:
                # Check if feature is enabled
                if not is_feature_enabled(feature_name):
                    return Response(
                        content=f'{{"detail": "Feature \'{feature_name}\' is disabled"}}',
                        status_code=403,
                        media_type="application/json"
                    )
            break
    
    # Check main endpoints
    endpoint_feature_map = {
        "/send-command/": "client",
        "/get-network-nodes/": "client",
        "/monitor/": "monitor",
        "/submit-policy/": "policies",
        "/add-data/": "adddata",
        "/view-blobs/": "viewfiles",
        "/view-streaming/": "viewfiles",
        "/get-preset-policy/": "presets",
    }
    
    if path in endpoint_feature_map:
        feature_name = endpoint_feature_map[path]
        if not is_feature_enabled(feature_name):
            return Response(
                content=f'{{"detail": "Feature \'{feature_name}\' is disabled"}}',
                status_code=403,
                media_type="application/json"
            )
    
    response = await call_next(request)
    return response

# Include routers conditionally based on feature config
if is_feature_enabled("sqlquery"):
    app.include_router(sql_router)
    print("✅ SQL Router enabled")
else:
    print("❌ SQL Router disabled")

# file_auth_router handles both bookmarks and presets
if is_feature_enabled("bookmarks") or is_feature_enabled("presets"):
    app.include_router(file_auth_router)
    print("✅ File Auth Router enabled (bookmarks/presets)")
else:
    print("❌ File Auth Router disabled")

if is_feature_enabled("security"):
    app.include_router(security_router)
    print("✅ Security Router enabled")
else:
    print("❌ Security Router disabled")

# Load plugins (will respect feature config internally)
load_plugins(app)

# Bootstrap default connection from REST_CONN env var
REST_CONN = os.getenv("REST_CONN")
if REST_CONN:
    REST_CONN = REST_CONN.strip()
    print(f"🔗 REST_CONN detected: {REST_CONN}")
    result = file_bookmark_node(REST_CONN)
    print(f"   Bookmark ensure result: {result}")
    result = file_set_default_bookmark(REST_CONN)
    print(f"   Set default result: {result}")
else:
    print("ℹ️  No REST_CONN env var set — skipping default connection bootstrap")

def _get_remote_gui_version() -> str:
    """Read Remote-GUI version from setup.cfg [metadata] remoteguiversion (fallback: version)."""
    try:
        project_root = os.path.dirname(os.path.dirname(BASE_DIR))
        setup_cfg_path = os.path.join(project_root, 'setup.cfg')
        if os.path.exists(setup_cfg_path):
            config = configparser.ConfigParser()
            config.read(setup_cfg_path)
            if not config.has_section('metadata'):
                return '—'
            if config.has_option('metadata', 'remoteguiversion'):
                v = config.get('metadata', 'remoteguiversion').strip()
                if v:
                    return v
            return config.get('metadata', 'version', fallback='—')
    except Exception:
        pass
    return '—'


@app.get("/version")
def get_version_endpoint():
    """Return Remote-GUI version from setup.cfg for the About page."""
    rg = _get_remote_gui_version()
    return {"version": rg, "remote_gui_version": rg}


@app.get("/env-config")
def get_env_config_endpoint():
    """Return non-secret environment variables used by the application."""
    # (name, description, default_value_or_None)
    ENV_VARS = [
        ("VITE_API_URL", "Frontend API URL", "http://localhost:8080"),
        ("FRONTEND_URL", "Allowed CORS origin(s)", "* (all origins)"),
        ("ALLOWED_HOSTS", "Allowed hosts", "*"),
        ("REST_CONN", "Default AnyLog node connection", None),
        ("REMOTE_GUI_FE", "Frontend port", "31800"),
        ("REMOTE_GUI_BE", "Backend port", "8080"),
        ("GRAFANA_URL", "Grafana dashboard URL", "http://23.239.12.151:3100/dashboards/f/ddu0qc65783r4a/smart-city"),
        ("ANYLOG_MCP_SSE_URL", "AnyLog MCP SSE endpoint", "http://50.116.13.109:32349/mcp/sse"),
        ("OLLAMA_MODEL", "Ollama LLM model", "qwen2.5:7b-instruct"),
        ("LLM_ENDPOINT", "LLM API endpoint", None),
        ("ANYLOG_REQUEST_TIMEOUT", "AnyLog request timeout (seconds)", None),
        ("ANYLOG_CONNECT_TIMEOUT", "AnyLog connect timeout (seconds)", "5.0"),
        ("ANYLOG_READ_TIMEOUT", "AnyLog read timeout (seconds)", "30.0"),
        ("DATA_DIR", "User management data directory", "./usr-mgm"),
    ]
    env_list = []
    for var_name, description, default in ENV_VARS:
        value = os.getenv(var_name)
        env_list.append({
            "name": var_name,
            "value": value if value is not None else None,
            "default": default,
            "description": description,
            "is_set": value is not None,
        })
    return {"environment": env_list}


# Feature configuration endpoint for frontend
@app.get("/feature-config")
def get_feature_config_endpoint():
    """Get the feature configuration for frontend"""
    config = load_feature_config()
    # Return only enabled status for each feature/plugin
    features_status = {
        name: {"enabled": data.get("enabled", True)}
        for name, data in config.get("features", {}).items()
    }
    plugins_status = {
        name: {"enabled": data.get("enabled", True)}
        for name, data in config.get("plugins", {}).items()
    }
    return {
        "features": features_status,
        "plugins": plugins_status,
        "version": config.get("version", "1.0.0")
    }

# Plugin order endpoint for frontend
@app.get("/plugins/order")
def get_plugin_order_endpoint():
    """Get the plugin order configuration for frontend display"""
    plugins_dir = os.path.join(BASE_DIR, 'plugins')
    plugin_order = get_plugin_order(plugins_dir)
    return {
        "plugin_order": plugin_order if plugin_order else [],
        "has_custom_order": plugin_order is not None
    }

# 23.239.12.151:32349
# run client () sql edgex extend=(+node_name, @ip, @port, @dbms_name, @table_name) and format = json and timezone=Europe/Dublin  select  timestamp, file, class, bbox, status  from factory_imgs where timestamp >= now() - 1 hour and timestamp <= NOW() order by timestamp desc --> selection (columns: ip using ip and port using port and dbms using dbms_name and table using table_name and file using file) -->  description (columns: bbox as shape.rect)


@app.get("/")
def list_static_files():
    try:
        files = []
        for root, dirs, filenames in os.walk(STATIC_DIR):
            for filename in filenames:
                rel_dir = os.path.relpath(root, STATIC_DIR)
                rel_file = os.path.join(rel_dir, filename) if rel_dir != '.' else filename
                files.append(rel_file)
        return {"files": files}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# @app.get("/")
def get_status():
    # print("GET STATUS RUNNING")
    resp = make_request("23.239.12.151:32349", "GET", "blockchain get *")
    return {"status": resp}
    # user = supabase_get_user()
    # return {"data": user}

# File-based authentication endpoints are now handled by file_auth_router


def should_force_raw_text(command_text: str) -> bool:
    """Force raw text for commands that are known to be non-tabular."""
    return "get msg client" in command_text.lower()



# NODE API ENDPOINTS

@app.post("/send-command/")
def send_command(conn: Connection, command: Command):
    # Feature check (also handled by middleware, but double-check for safety)
    if not is_feature_enabled("client"):
        raise HTTPException(status_code=403, detail="Feature 'client' is disabled")
    try:
        normalized_cmd = command.cmd.strip()
        force_raw_text = should_force_raw_text(normalized_cmd)
        raw_response = make_request(conn.conn, command.type, normalized_cmd)
        print("raw_response", raw_response)

        # Check if the response is already an error response
        if isinstance(raw_response, dict) and raw_response.get("type") == "error":
            print("=== ERROR RESPONSE DETECTED ===")
            print(f"Full error response: {raw_response}")
            return raw_response

        if command.raw_text or force_raw_text:
            return {"type": "raw", "data": str(raw_response) if raw_response is not None else ""}

        structured_data = parse_response(raw_response)
        print("structured_data", structured_data)
        return structured_data
    except Exception as e:
        print(f"=== MAIN.PY ERROR ===")
        print(f"Error type: {type(e).__name__}")
        print(f"Error message: {str(e)}")
        print(f"Command: {command.cmd}")
        print(f"Connection: {conn.conn}")
        print(f"=== END MAIN.PY ERROR ===")
        
        return {
            "type": "error",
            "data": f"Backend error: {str(e)}",
            "error_details": {
                "error_type": type(e).__name__,
                "error_message": str(e),
                "command": command.cmd,
                "connection": conn.conn,
                "location": "main.py send_command"
            }
        }


@app.post("/get-network-nodes/")
def get_connected_nodes(conn: Connection):
    # Feature check
    if not is_feature_enabled("client"):
        raise HTTPException(status_code=403, detail="Feature 'client' is disabled")
    connected_nodes = grab_network_nodes(conn.conn)
    return {"data": connected_nodes}

@app.post("/monitor/")
def monitor(conn: Connection):
    # Feature check
    if not is_feature_enabled("monitor"):
        raise HTTPException(status_code=403, detail="Feature 'monitor' is disabled")
    monitored_nodes = monitor_network(conn.conn)
    return {"data": monitored_nodes}

@app.post("/submit-policy/")
def submit_policy(conn: Connection, policy: Policy):
    # Feature check
    if not is_feature_enabled("policies"):
        raise HTTPException(status_code=403, detail="Feature 'policies' is disabled")
    print("conn", conn)
    print("policy", policy)
    raw_response = make_policy(conn.conn, policy)

    structured_data = parse_response(raw_response)
    return structured_data


@app.post("/add-data/")
def send_data(conn: Connection, dbconn: DBConnection, data: list[Dict]):
    # Feature check
    if not is_feature_enabled("adddata"):
        raise HTTPException(status_code=403, detail="Feature 'adddata' is disabled")
    print("conn", conn.conn)
    print("db", dbconn.dbms)
    print("table", dbconn.table)
    print("data", type(data))

    raw_response = send_json_data(conn=conn.conn, dbms=dbconn.dbms, table=dbconn.table, data=data)

    structured_data = parse_response(raw_response)
    return structured_data


# Bookmark and preset endpoints are now handled by file_auth_router


# All bookmark and preset endpoints are now handled by file_auth_router


# Preset group endpoints are now handled by file_auth_router


# All preset endpoints are now handled by file_auth_router

@app.post("/get-preset-policy/")
def get_preset_policy():
    """
    Get all presets for a specific group for the authenticated user.
    """
    # Feature check
    if not is_feature_enabled("presets"):
        raise HTTPException(status_code=403, detail="Feature 'presets' is disabled")

    resp = helpers.get_preset_base_policy("23.239.12.151:32349")
    parsed = parse_response(resp)
    lb = parsed['data']['bookmark']['bookmarks']
    print("list of bookmarks:", lb)
    filtered_lb = {key: value for key, value in lb.items() if isinstance(value, dict)}
    
    return {"data": filtered_lb}


def construct_streaming_url(blob, connectInfo):
    """Construct streaming URL for a blob"""
    # Use the blob's node IP and port, not the connected node
    ip = blob.get('ip', '')
    port = blob.get('port', '')
    
    # If blob doesn't have ip/port, fall back to connected node
    if not ip or not port:
        if isinstance(connectInfo, str):
            # If connectInfo is a string like "23.239.12.151:32349", parse it
            if ':' in connectInfo:
                ip, port = connectInfo.split(':', 1)
            else:
                ip = connectInfo
                port = '32349'  # default port
        else:
            # If connectInfo is a dict, extract ip and port
            ip = connectInfo.get('ip', '')
            port = connectInfo.get('port', '')
    
    # Extract blob details
    dbms = blob.get('dbms_name', '')
    table = blob.get('video_table') or blob.get('table_name', '')
    blob_id = blob.get('file', '')  # Use 'file' instead of 'id' as blob_id
    
    # Construct the streaming URL using the blob's node
    streaming_url = f"http://{ip}:{port}/?User-Agent=AnyLog/1.23?command=file retrieve where dbms={dbms} and table={table} and id={blob_id} and stream=true?cb="
    
    return streaming_url

@app.post("/view-streaming/")
def view_streaming_blobs(request: dict):
    # Feature check
    if not is_feature_enabled("viewfiles"):
        raise HTTPException(status_code=403, detail="Feature 'viewfiles' is disabled")
    try:
        print(f"=== STREAMING REQUEST ===")
        print(f"Request type: {type(request)}")
        print(f"Request keys: {request.keys() if isinstance(request, dict) else 'Not a dict'}")
        print(f"Full request: {request}")
        print(f"=== END STREAMING REQUEST ===")
        
        # Extract connection and blob information
        connectInfo = request.get('connectInfo', {})
        blobs = request.get('blobs', {}).get('blobs', [])
        
        print(f"ConnectInfo: {connectInfo} (type: {type(connectInfo)})")
        print(f"Blobs: {blobs} (type: {type(blobs)}, length: {len(blobs) if isinstance(blobs, list) else 'N/A'})")
        
        # Construct streaming URLs for each blob
        streaming_urls = []
        for i, blob in enumerate(blobs):
            print(f"Processing blob {i}: {blob}")
            url = construct_streaming_url(blob, connectInfo)
            streaming_urls.append({
                'id': blob.get('file', ''),  # Use file as id
                'file': blob.get('file', ''),
                'streaming_url': url,
                'dbms': blob.get('dbms_name', ''),
                'table': blob.get('video_table') or blob.get('table_name', ''),
                'ip': blob.get('ip', ''),
                'port': blob.get('port', '')
            })
            print(f"Created streaming URL: {url}")
        
        print(f"Final streaming_urls: {streaming_urls}")
        
        return {
            "type": "streaming_urls",
            "data": streaming_urls
        }
    except Exception as e:
        print(f"=== STREAMING ERROR ===")
        print(f"Error type: {type(e).__name__}")
        print(f"Error message: {str(e)}")
        print(f"Request: {request}")
        print(f"=== END STREAMING ERROR ===")
        
        return {
            "type": "error",
            "data": f"Error constructing streaming URLs: {str(e)}",
            "error_details": {
                "error_type": type(e).__name__,
                "error_message": str(e),
                "request": str(request)
            }
        }


@app.post("/view-blobs/")
def view_blobs(conn: Connection, blobs: dict):
    # Feature check
    if not is_feature_enabled("viewfiles"):
        raise HTTPException(status_code=403, detail="Feature 'viewfiles' is disabled")
    print("conn", conn.conn)
    # print("blobs", blobs['blobs'])

    file_list = []
    for blob in blobs['blobs']:
        print("blob", blob)
        # Here you would implement the logic to view the blob

        ip_port = f"{blob['ip']}:{blob['port']}"
        operator_dbms = blob['dbms_name']
        operator_table = blob.get('video_table') or blob.get('table_name', '')
        operator_file = blob['file']
        file_list.append(operator_file)

        # blobs_dir = "/app/Remote-CLI/djangoProject/static/blobs/current/"
        blobs_dir = "/app/CLI/local-cli-backend/static/"
        # if not os.path.exists(blobs_dir): 
        #     print("Blobs directory does not exist")
        #     root = __file__.split("CLI")[0] 
        #     blobs_dir = blobs_dir.replace('/app', root) 
        print("IP:Port", ip_port)

        print("blobs_dir", blobs_dir)


        # cmd = f'run client ({ip_port}) file get !!blockchain_file !blockchain_file'
        # cmd = f'run client ({ip_port}) file get !!blobs_dir/{operator_file} !blobs_dir/{operator_file}'
        

        cmd = f"run client ({ip_port}) file get (dbms = blobs_{operator_dbms} and table = {operator_table} and id = {operator_file}) {blobs_dir}{operator_dbms}.{operator_table}.{operator_file}"  # Add file full path and name for the destination on THIS MACHINE
        raw_response = make_request(conn.conn, "POST", cmd)

        try:
            files_in_dir = os.listdir(blobs_dir)
            print("Files in blobs_dir:", files_in_dir)
        except Exception as e:
            print(f"Error listing files in {blobs_dir}: {e}")
            files_in_dir = []

        print("raw_response", raw_response)


    return {"data": file_list}



# streaming
# info = (dest_type = rest) 
# for streaming — views.py method stream_process
# uses post
# cmd: source_url = f"http://{ip}:{port}/?User-Agent=AnyLog/1.23?command=file retrieve where dbms={dbms} and table={table} and id={file} and stream = true"

# build image or video or audio (aka any file) viewer




# http://45.33.110.211:31800
