from fastapi import APIRouter, Form, File, UploadFile, HTTPException
from pydantic import BaseModel
from typing import Dict, List
import shutil
import uuid
from pathlib import Path
from .documentvalidator import validate_file
import helpers
import requests
from pathlib import Path

# Create the API router
api_router = APIRouter(prefix="/fileuploader", tags=["File Uploader"])

# API endpoints
@api_router.get("/")
async def fileuploader_info():
    """Get File Uploader information"""
    return {
        "name": "File Uploader Plugin",
        "version": "1.0.0",
    }

def get_directories(dir_response: str) -> List[str]:
    if "Directory does not exist" in dir_response:
        return []
    return [line.replace("\r", "").replace("/app/AnyLog-Network/data/", "") for line in dir_response.split("\n")]

def _create_dir(conn: str) -> requests.Response | None:
    headers = {
        "command": "system mkdir -p /app/AnyLog-Network/data/upload_dir",
        "User-Agent": "AnyLog/1.23",
        "Content-Type": "text/plain"
    }

    try:
        response = requests.post(f"http://{conn}", data='', headers=headers)
    except Exception as e:
        print(f"Error: {e}")
        return None
    return response

def create_upload_dir(conn: str) -> bool:
    # Check if directory already exists in the node
    command = "get directories /app/AnyLog-Network/data/"
    helper_response = helpers.make_request(conn=conn, method="GET", command=command)
    if not isinstance(helper_response, dict): 
        directories = get_directories(helper_response)
    else:
        directories = None

    if directories is not None and "upload_dir" in directories:
        return True

    # If directory doesn't exit, create it
    print("Couldn't find upload_dir, attempting to create it...")
    request_response = _create_dir(conn)
    if request_response is not None and request_response.status_code == 200:
        return True
    else:
        return False

def _get_files(helper_response: str, dir: str) -> List[str]:
    if "No files with path provided:" in helper_response:
        return []
    return [line.replace("\r", "").replace(dir, "") for line in helper_response.split("\n")]

def get_filename(conn: str, file: UploadFile, dir: str = '/app/AnyLog-Network/data/upload_dir/') -> str:
    command = f"get files {dir}"
    helper_response = helpers.make_request(conn=conn, method="GET", command=command)

    if isinstance(helper_response, dict):
        raise ValueError("AnyLog raised an error when accessing files") 
    
    files = _get_files(helper_response, dir)
    if file.filename not in files:
        return file.filename
    
    path = Path(file.filename)

    i = 1
    while f"{path.stem}-{i}{path.suffix}" in files:
        i += 1
    return f"{path.stem}-{i}{path.suffix}"

def push_file(conn: str, file: UploadFile, dir: str = '/app/AnyLog-Network/data/upload_dir/') -> str:
    filename = get_filename(conn, file, dir)

    command = f"file to {dir}{filename}"

    headers = {
        'User-Agent': 'AnyLog/1.23',
        'Content-Type': 'application/octet-stream',
        'command': command,
        'Accept': '*/*'
    }

    requests.post(f'http://{conn}', headers=headers, data=file.file)
    return filename

@api_router.post("/upload")
async def add_files(files: List[UploadFile] = File(...),
                    conn: str = Form(...)) -> Dict[str, int | List[Dict[str, str | bool | List[str] | None]]]:
    """Upload a list of files to the upload directory"""

    dest_exists = create_upload_dir(conn)
    if not dest_exists:
        raise HTTPException(status_code=501, detail="upload directory does not exist")
    dir = "/app/AnyLog-Network/data/upload_dir/"

    results: List[Dict[str, str | bool | List[str] | None]] = []

    for file in files:
        validation = await validate_file(file)

        if not validation['valid']:
            results.append({
                "filename": file.filename,
                "success": False,
                "errors": validation["errors"]
            })
            continue

        try:
            stored_name = push_file(conn, file, dir)

            results.append({
                "filename": file.filename,
                "stored_filename": stored_name,
                "success": True,
                "location": f'{dir}{stored_name}'
            })
        except Exception as e:
            results.append({
                "filename": file.filename,
                "success": False,
                "errors": [f"Upload failed: {str(e)}"]
            })

    successful = [r for r in results if r["success"]]
    failed = [r for r in results if not r["success"]]

    return {
        "total_files": len(files),
        "successful": len(successful),
        "failed": len(failed),
        "results": results
    }
