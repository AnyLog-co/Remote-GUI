from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from typing import Optional, List, Dict
import os
import io
import asyncio
import json
import paramiko

api_router = APIRouter(prefix="/sshclient", tags=["SSH Client"])

ALLOWED_METHODS = ["direct_ssh", "docker_attach", "docker_exec"]
# Possible Allowed Conn method: 
ALLOWED_CONNECTION_METHODS = ["password","key-string","keyfile"]


sessions = {}

async def listen_to_ssh(ws: WebSocket, channel: paramiko.Channel):
    try:
        while True:
            if channel.recv_ready():
                output = channel.recv(4096).decode('utf-8', 'replace')
                await ws.send_text(output)
            await asyncio.sleep(0.02)
    except Exception:
        pass

def connect_client(host, user, password= None, pkey = None):
    try:
        # If no password provided aka using key... Client will connect accordingly
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(
            hostname=host,
            username=user,
            port=22,
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
    

def open_ssh_chan(host, user, conn_method):
    pref_method = conn_method.get('method')
    method_data = conn_method.get('data')
    print('Method: ', pref_method)

    if pref_method not in ALLOWED_CONNECTION_METHODS:
        print('Connection Method Error: Not key or password.\n')
        return None
    
    match pref_method:
        case 'password':
            print('Connecting via password...')
            client = connect_client(host, user, password=method_data)


        case 'key-string':
            print('Connecting via Key [String]...')

            key_stream = io.StringIO(method_data)


            # Returns paramiko key object to be used for ssh auth.
            try:
                key = paramiko.Ed25519Key.from_private_key(key_stream)
            except paramiko.SSHException:
                # If key is RSA do this
                key_stream.seek(0)
                key = paramiko.RSAKey.from_private_key(key_stream)

            client = connect_client(host, user, pkey=key)

        case 'keyfile':
            print('Connecting via Key [File]...')

            try:
                key = paramiko.Ed25519Key.from_private_key_file(method_data)
            except paramiko.SSHException:
                # If key is RSA do this
                key = paramiko.RSAKey.from_private_key_file(method_data)

            client = connect_client(host, user, pkey=key)


    return client

@api_router.websocket("/ws")
async def ws_handler(ws: WebSocket):
    await ws.accept()
    
    channel = None

    try:
        while True:
            message = await ws.receive_json()
            action = message.get("action")
            conn_method_info = message.get('conn_method')


            if action in ALLOWED_METHODS:
                cols = message.get("cols", 80)
                rows = message.get("rows", 24)
                
                client = open_ssh_chan(
                    message["host"],
                    message["user"],
                    conn_method_info,
                )

                
                if not client:
                    print('Unauthorized User.')
                    await ws.close(code=1008, reason='Unauthorized User')
                    return None

                if action == "direct_ssh":
                    channel = client.invoke_shell(term="xterm", width=cols, height=rows)
                    await ws.send_text("Connected to SSH\r\n")
                else:
                    transport = client.get_transport()
                    channel = transport.open_session()
                    channel.get_pty(term="xterm", width=cols, height=rows)

                    if action == "docker_attach":
                        channel.exec_command("docker attach anylog-query1")
                        await ws.send_text("Attached to anylog-query1. Press <ctrl>p and then <ctrl>q to detach\r\n")

                    if action == "docker_exec":
                        channel.exec_command("docker exec -it anylog-query1 sh")
                        await ws.send_text("Started in anylog-query1\r\n")

                sessions[ws] = {
                    "client": client,
                    "channel": channel
                }
                asyncio.create_task(listen_to_ssh(ws, channel))
            elif action == "resize":
                if ws in sessions and sessions[ws].get("channel"):
                    channel = sessions[ws]["channel"]
                    cols = message.get("cols", 80)
                    rows = message.get("rows", 24)
                    channel.resize_pty(width=cols, height=rows)
            elif action == "client_input":
                if channel:
                    channel.send(message.get("input", ""))
    except WebSocketDisconnect:
        print('WS Disconnect\n')
    except Exception as e:
        if str(e).lower() == "socket is closed":
            await ws.send_text("Internal connection to remote host broken")
        else:
            await ws.send_text(f"\r\nSSH ERROR: {str(e)}\r\n")
        await ws.close()
    finally:
        session = sessions.pop(ws, None)
        if session:
            channel = session.get("channel")
            client = session.get("client")
            if channel:
                channel.close()
            if client:
                client.close()
