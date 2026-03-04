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
from pydantic import BaseModel
import re

# Create the API router
api_router = APIRouter(prefix="/fileuploader", tags=["File Uploader"])

class getDirectoriesRequest(BaseModel):
    conn: str
    directory_path: str

# API endpoints
@api_router.get("/")
async def fileuploader_info():
    """Get File Uploader information"""
    return {
        "name": "File Uploader Plugin",
        "version": "1.0.0",
        "description": "Upload files to a directory",
        "endpoints": [
            "/upload - Upload a list of files to the upload directory",
            "/get-directories - Get all directories in a given a directory path",
        ]
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

@api_router.post("/get-directories")
async def get_current_directories(request: getDirectoriesRequest) -> List[str]:
    """Get all directories in a given a directory path"""

    conn = request.conn
    directory_path = request.directory_path

    # file validation (does not use AfterValidator since we want our loader to have an empty directory sent back)
    if re.search("^/app/.*$", directory_path) is None:
        return []
    elif re.search("^/app(/([^/]+))*/?$", directory_path) is None:
        return []
    elif ".." in directory_path:
        return []
    
    # ex: /app/AnyLog-Network/data/test -> /app/AnyLog-Network/data
    parent_path = directory_path
    if directory_path[len(directory_path) - 1] != '/':
        parent_path = Path(directory_path).parent

    try:
        command = f"get directories {parent_path}"
        helper_response = helpers.make_request(conn=conn, method="GET", command=command)
        if not isinstance(helper_response, dict):
            if "Directory does not exists" in helper_response or "No sub directories" in helper_response:
                return []
            directories = [line.replace("\r", "") for line in helper_response.split("\n")]

            if directories[0] == '':
                directories.pop(0)
            
            # put matching directories at the front (iterate backwards to prevent index shifting)
            matches = []
            for i in range(len(directories) - 1, -1, -1):
                if directory_path.lower() in directories[i].lower():
                    matches.append(directories.pop(i))
            
            # reverse list of matching directories to preserve its order in the original list
            return matches[::-1] + directories
        else:
            return []

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get directories: {str(e)}")

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
