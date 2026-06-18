import asyncio
import io
import json
import os
import uuid

import paramiko
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
import logging
from logging.handlers import SysLogHandler

class JSONFormatter(logging.Formatter):
    def format(self, record):
        return json.dumps({
            "time": self.formatTime(record),
            "name": record.name,
            "level": record.levelname,
            "message": record.getMessage()
        })

logger = logging.getLogger("SSH_Client")
logger.setLevel(logging.INFO)

syslog_address = "/var/run/syslog" if os.path.exists("/var/run/syslog") else "/dev/log"
handler = SysLogHandler(address=syslog_address)
handler.setFormatter(JSONFormatter())
logger.addHandler(handler)

# Backend-required 'api_router' object to consume SSHClient's router into main router
api_router = APIRouter(prefix="/sshclient", tags=["SSH Client"])

# Allowed on-start tasks
ALLOWED_ON_START_TASKS = ["direct_ssh", "docker_attach", "docker_exec"]
# Possible allowed conn method.
ALLOWED_CONNECTION_METHODS = ["password", "key-string", "keyfile"]
input_buffer = {}

# Global mapping of all active SSH sessions by frontend terminal id.
sessions = {}
DETACHED_SESSION_TTL_SECONDS = 3600
MAX_SESSION_BUFFER_CHARS = 200000

def container_exists(ssh_client, container_name: str) -> bool:
    """Returns True if the container exists on the remote host."""
    _, stdout, _ = ssh_client.exec_command(
        f"docker inspect --format='{{{{.State.Status}}}}' {container_name} 2>/dev/null"
    )
    output = stdout.read().decode().strip()
    return bool(output) 

def append_session_output(session: dict, output: str):
    session["output_buffer"] = (session.get("output_buffer", "") + output)[
        -MAX_SESSION_BUFFER_CHARS:
    ]


async def send_session_output(session_id: str, output: str):
    session = sessions.get(session_id)
    if not session:
        return

    append_session_output(session, output)
    ws = session.get("ws")
    if not ws:
        return

    try:
        await ws.send_text(output)
    except Exception:
        if sessions.get(session_id, {}).get("ws") is ws:
            sessions[session_id]["ws"] = None


async def close_session(session_id: str, reason: str = ""):
    session = sessions.pop(session_id, None)
    input_buffer.pop(session_id, None)
    if not session:
        return

    cleanup_task = session.get("cleanup_task")
    if cleanup_task:
        cleanup_task.cancel()

    listener_task = session.get("listener_task")
    current_task = asyncio.current_task()
    if listener_task and listener_task is not current_task:
        listener_task.cancel()

    ws = session.get("ws")
    if ws:
        try:
            await ws.close(code=1000, reason=reason or "SSH session closed")
        except Exception:
            pass

    channel = session.get("channel")
    client = session.get("client")
    if channel:
        channel.close()
    if client:
        client.close()


async def cleanup_detached_session(session_id: str):
    await asyncio.sleep(DETACHED_SESSION_TTL_SECONDS)
    session = sessions.get(session_id)
    if session and not session.get("ws"):
        await close_session(session_id, "Detached SSH session expired")


async def detach_ws(session_id: str, ws: WebSocket):
    session = sessions.get(session_id)
    if not session or session.get("ws") is not ws:
        return

    session["ws"] = None
    cleanup_task = session.get("cleanup_task")
    if cleanup_task:
        cleanup_task.cancel()
    session["cleanup_task"] = asyncio.create_task(cleanup_detached_session(session_id))


async def attach_ws(session_id: str, ws: WebSocket, cols: int = 80, rows: int = 24):
    session = sessions.get(session_id)
    if not session:
        await ws.close(code=1008, reason="SSH session no longer exists")
        return False

    cleanup_task = session.get("cleanup_task")
    if cleanup_task:
        cleanup_task.cancel()
        session["cleanup_task"] = None

    old_ws = session.get("ws")
    if old_ws and old_ws is not ws:
        try:
            await old_ws.close(code=1000, reason="SSH session attached elsewhere")
        except Exception:
            pass

    session["ws"] = ws
    channel = session.get("channel")
    if channel:
        try:
            channel.resize_pty(width=cols, height=rows)
        except Exception:
            pass

    output_buffer = session.get("output_buffer")
    if output_buffer:
        await ws.send_text(output_buffer)
    return True


async def listen_to_ssh(session_id: str):
    """
    Continuously listens to receiving messages from Paramiko Channel and relays to WebSocket
    """
    try:
        while True:
            session = sessions.get(session_id)
            if not session:
                return

            channel = session.get("channel")
            if not channel or channel.closed:
                await close_session(session_id, "SSH session ended")
                return

            if channel.recv_ready():
                output = channel.recv(4096).decode("utf-8", "replace")
                await send_session_output(session_id, output)
            # Avoid wasting possible sleep cycles
            await asyncio.sleep(0.02)
    except asyncio.CancelledError:
        raise
    except Exception as e:
        await send_session_output(session_id, f"\r\nSSH ERROR: {str(e)}\r\n")
        await close_session(session_id, str(e))


def connect_client(ip, user, port, password=None, pkey=None) -> paramiko.SSHClient:
    """
    Inputs hostname, user, password, or possible p-key and returns a Paramiko-initialized Client
    """
    try:
        # If no password provided aka using key... Client will connect accordingly
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(
            hostname=ip,
            username=user,
            port=port,
            password=password,
            pkey=pkey,
            timeout=10,
        )

        return client

    except paramiko.AuthenticationException:
        print("Paramiko Client Error : Unable to Authorize Client.")
        return None
    except Exception as e:
        print("Error creating Paramiko Client:", e)
        return None


def open_ssh_chan(ip, name, user, port, conn_method):
    """
    Requires a hostname, user, and conn_method object
    conn_method in form of a dictionary:
        {
            'method': '',
            'data': ''
        }
        method: "password" or "key-string" or "keyfile"
        data: <SSH_PASSWORD> or <SSH_KEYDATA>
    """
    pref_method = conn_method.get("method")
    method_data = conn_method.get("data")


    print("Method: ", pref_method)
    print("Port: ", port)


    if pref_method not in ALLOWED_CONNECTION_METHODS:
        print("Connection Method Error: Not key or password.\n")
        return None

    match pref_method:
        # Password
        case "password":
            print("Connecting via password...")
            client = connect_client(ip, user, port, password=method_data)

        case "key-string":
            # Handle key file data as string
            print("Connecting via Key [String]...")

            key_stream = io.StringIO(method_data)

            # Returns paramiko key object to be used for ssh auth.
            try:
                key = paramiko.Ed25519Key.from_private_key(key_stream)
            except paramiko.SSHException:
                # If key is RSA do this
                # Return to beginning of ket_stream and read RSA
                key_stream.seek(0)
                key = paramiko.RSAKey.from_private_key(key_stream)

            client = connect_client(ip, user, port, pkey=key)

        case "keyfile":
            # Handle raw keyfile data buffer
            print("Connecting via Key [File]...")

            try:
                # Handle default Ed25519Key key type
                key = paramiko.Ed25519Key.from_private_key_file(method_data)
            except paramiko.SSHException:
                # Default to RSA key
                key = paramiko.RSAKey.from_private_key_file(method_data)

            client = connect_client(ip, user, pkey=key)

    return client


@api_router.websocket("/ws")
async def ws_handler(ws: WebSocket):
    # WebSocket endpoint to handle SSHClient logic
    await ws.accept()

    session_id = None

    try:
        while True:
            message = await ws.receive_json()

            session_id = message.get("session_id") or session_id
            node_name = message.get("name")
            action = message.get("action")
            conn_method_info = message.get("conn_method")

            if action == "reattach":
                cols = message.get("cols", 80)
                rows = message.get("rows", 24)
                if not session_id or not await attach_ws(session_id, ws, cols, rows):
                    return
                continue

            if action in ALLOWED_ON_START_TASKS:
                cols = message.get("cols", 80)
                rows = message.get("rows", 24)
                session_id = session_id or str(uuid.uuid4())

                if session_id in sessions:
                    await attach_ws(session_id, ws, cols, rows)
                    continue

                client = open_ssh_chan(
                    message["ip"],
                    node_name,
                    message["user"],
                    message["port"],
                    conn_method_info,
                )


                if not client:
                    print("Invalid Credentials.")
                    await ws.close(code=1008, reason="Invalid Credentials")
                    return None

                if action == "direct_ssh":
                    # Create default shell. No other on-start commands
                    channel = client.invoke_shell(term="xterm", width=cols, height=rows)
                    initial_output = "Connected to SSH\r\n"
                else:
                    # Create a shell session
                    transport = client.get_transport()
                    channel = transport.open_session()
                    channel.get_pty(term="xterm", width=cols, height=rows)

                    if action == "docker_attach":
                        if not container_exists(client, node_name):
                            await ws.close(code=1008, reason=f"Container '{node_name}' not found")
                            return

                        # Create shell and launch docker attach to node on-start
                        channel.exec_command(f"docker attach {node_name}")
                        # Relay shell ready status
                        logger.info(f'docker attach {node_name}')
                        initial_output = f"Attached to {node_name}. Press <ctrl>p and then <ctrl>q to detach\r\n"

                    if action == "docker_exec":
                        if not container_exists(client, node_name):
                            await ws.close(code=1008, reason=f"Container '{node_name}' not found")
                            return
                        # Create shell and launch docker exec to node on-start
                        channel.exec_command(f"docker exec -it {node_name} sh")
                        logger.info(f'docker exec -it {node_name} sh')

                        # Relay shell ready status
                        initial_output = f"Started in {node_name}\r\n"

                # Store connection within global sessions
                sessions[session_id] = {
                    "client": client,
                    "channel": channel,
                    "ws": ws,
                    "output_buffer": "",
                    "cleanup_task": None,
                    "listener_task": None,
                }
                await send_session_output(session_id, initial_output)

                # Start SSH loop task
                sessions[session_id]["listener_task"] = asyncio.create_task(
                    listen_to_ssh(session_id)
                )
            elif action == "resize":
                # Handle terminal resizing and dynamic adjustment
                if session_id in sessions and sessions[session_id].get("channel"):
                    channel = sessions[session_id]["channel"]
                    cols = message.get("cols", 80)
                    rows = message.get("rows", 24)
                    channel.resize_pty(width=cols, height=rows)
            elif action == "client_input":
                # Relay user keystrokes in terminal
                session = sessions.get(session_id)
                channel = session.get("channel") if session else None
                if channel:
                    data = message.get("input", "")
                    channel.send(data)
                    
                    # Log completed input only
                    input_buffer.setdefault(session_id, "")
                    if "\r" in data or "\n" in data:
                        if input_buffer[session_id].strip(): 
                            logger.info(f'input: {input_buffer[session_id]}')
                        input_buffer[session_id] = ""
                    else:
                        input_buffer[session_id] += data
            elif action == "close_session":
                if session_id:
                    await close_session(session_id, "SSH session closed")
                return
    except WebSocketDisconnect:
        print("WS Disconnect\n")
    except Exception as e:
        # Try to return error to user's WebSocket and close
        try:
            if str(e).lower() == "socket is closed":
                await ws.send_text("Internal connection to remote host broken")
            else:
                await ws.send_text(f"\r\nSSH ERROR: {str(e)}\r\n")
            await ws.close()
        except Exception:
            pass
    finally:
        if session_id:
            await detach_ws(session_id, ws)
