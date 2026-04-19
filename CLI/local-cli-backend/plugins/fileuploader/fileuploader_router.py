from fastapi import APIRouter, Form, File, UploadFile, HTTPException
from pydantic import BaseModel
from typing import Dict, List
import pathlib
from requests_toolbelt import MultipartEncoder
from .documentvalidator import validate_file
import helpers
import requests
from pathlib import Path
from .pathparser import PathParser

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

# executes server info retrieval command
def get_server_info(conn: str) -> Dict[str, str]:
    helper_response_raw = helpers.make_request(conn=conn, method="GET", command="get rest server info")
    if not isinstance(helper_response_raw, str):
        return {}
    helper_response_better = helper_response_raw.replace(' ', '')
    helper_response_lines = helper_response_better.split('\n')

    info_pairs = [line.split("|") for line in helper_response_lines]
    server_info = {pair[0]: pair[1] for pair in info_pairs if len(pair) >= 2}
    return server_info

# gets the connection (also checks if it is http or https)
conn_map: Dict[str, str] = {}
def get_raw_connection(conn: str) -> str:
    try:
        return conn_map[conn]
    except KeyError:
        pass

    server_info = get_server_info(conn)
    try:
        connection = server_info['connection']
        conn_map[conn] = connection
        return connection
    except KeyError:
        return f"http://{conn}"

# takes in string response of directories (including parents) and turns it into a list of just the directories
def _get_directories(dir_response: str, dir_parent: str) -> List[str]:
    if "Directory does not exist" in dir_response:
        return []
    return [line.replace("\r", "").replace(dir_parent, "")[1:] for line in dir_response.split("\n")]

# executes a directory creation command
def _create_dir(conn: str, dir: str = "/app/AnyLog-Network/data/upload_dir") -> requests.Response | None:
    headers = {
        "command": f"system mkdir -p {dir}",
        "User-Agent": "AnyLog/1.23",
        "Content-Type": "text/plain"
    }

    try:
        response = requests.post(get_raw_connection(conn), data='', headers=headers)
    except Exception as e:
        print(f"Error: {e}")
        return None
    return response

# checks if directory exists before creating it (returns True if successful)
def create_dir(conn: str, dir: str) -> bool:
    path = PathParser(dir)
    if path.hasExt():
        raise ValueError("Directory must not have an extension")
    parent = path.parent()

    # Check if directory already exists in the node
    command = f"get directories {parent}"
    helper_response = helpers.make_request(conn=conn, method="GET", command=command)
    if not isinstance(helper_response, dict): 
        directories = _get_directories(helper_response, str(parent))
    else:
        directories = None

    if directories is not None and path.stem() in directories:
        return True

    # If directory doesn't exist, create it
    print(f"Couldn't find directory {path}, attempting to create it...")
    request_response = _create_dir(conn, str(path))
    if request_response is not None and request_response.status_code == 200:
        return True
    else:
        return False

# makes get request and returns a list of the file names
def exec_get_files(conn: str, dir: PathParser) -> List[str]:
    command = f"get files {dir}"
    helper_response = helpers.make_request(conn=conn, method="GET", command=command)

    if isinstance(helper_response, dict):
        raise ValueError("AnyLog raised an error when accessing files") 
    
    files = _get_files(helper_response, dir)
    return files

# takes in string response of file names (including their paths) and turns it into a list of just the file names
def _get_files(helper_response: str, dir: PathParser) -> List[str]:
    if "No files with path provided:" in helper_response:
        return []
    return [line.replace("\r", "").replace(f"{dir}/", "") for line in helper_response.split("\n")]

# numbering system for duplicate file names: append a "-n" to the end, where n is the smallest valid number
def get_numbered_filename(file: UploadFile, files: List[str]) -> str:
    path = Path(file.filename)

    i = 1
    while f"{path.stem}-{i}{path.suffix}" in files:
        i += 1
    return f"{path.stem}-{i}{path.suffix}"

def push_file(conn: str, file: UploadFile, filename: str, dir: PathParser) -> str:

    try:

        # mimics file uploading via curl
        fileField = MultipartEncoder(
            fields={
                'file': (file.filename, file.file, file.content_type)
            }
        )

        command = f"file to {dir}/{filename}"

        headers = {
            'User-Agent': 'AnyLog/1.23',
            'Content-Type': file.content_type,
            'command': command,
            'Accept': '*/*'
        }

        r = requests.post(get_raw_connection(conn), headers=headers, data=fileField)
        if (r.status_code != 200):
            # r.text prints whole response, including body as a dictionary string
            r_text = r.text.split('\r\n\r\n')[-1]
            r_text = r_text.strip("{}")

            # # removes quotes in each key-value pair and makes string dictionary into dictionary
            r_dict = dict([kv.strip('"') for kv in item.split(": ")] for item in r_text.split(", "))
            print(f"REPORTED PUSH FAILURE ({r.status_code}, {r_dict.get("err_code")})")
            raise Exception(r_dict.get("err_text"))
        return filename
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"{e}")

@api_router.post("/get-directories")
async def get_current_directories(request: getDirectoriesRequest) -> List[str]:
    """Get all directories in a given a directory path"""

    conn = request.conn
    directory_path = request.directory_path

    # file validation (does not use AfterValidator since we want our loader to have an empty directory sent back)
    try:
        PathParser(directory_path)
    except ValueError:
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

            # directory list may have a '' in the front, so remove it
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
async def add_files(files: List[UploadFile] = File(...), duplicateHandlingOptions: List[str] = Form(...),
                    conn: str = Form(...), directory_path: str = Form(...)) -> Dict[str, int | List[Dict[str, str | bool | List[str] | None]]]:
    """Upload a list of files to the upload directory"""

    dest_exists = create_dir(conn, directory_path)
    if not dest_exists:
        raise HTTPException(status_code=501, detail="upload directory does not exist")

    dir_path = PathParser(directory_path)

    results: List[Dict[str, str | bool | List[str] | None]] = []

    for file, option in zip(files, duplicateHandlingOptions):
        validation = await validate_file(file)

        if not validation['valid']:
            results.append({
                "filename": file.filename,
                "success": False,
                "errors": validation["errors"]
            })
            continue

        try:
            stored_name = ""

            # first, check if file name exists
            # can optimize api calls by keeping a local copy of this list
            file_list = exec_get_files(conn, dir_path)
            file_already_exists = file.filename in file_list
            if file_already_exists and option != 'replace':

                # if on skip option, abort the upload for this file and give warning (instead of error)
                if option == 'skip':
                    results.append({
                        "filename": file.filename,
                        "success": False,
                        "skipped": True,
                        "warning": "File already exists in this folder and the 'Skip' option was selected"
                    })
                    continue
                
                # if on keep option, get a numbered file name
                if option == 'keep':
                    name = get_numbered_filename(file, file_list) if file_already_exists else file.filename
                    stored_name = push_file(conn, file, name, dir_path)

                # if an option was somehow not selected, skip uploading this file and give a warning
                else:
                    results.append({
                        "filename": file.filename,
                        "success": False,
                        "skipped": True,
                        "warning": "No option selected for handling files with the same name"
                    })
                    continue
            else:
                # otherwise, push file as normal
                stored_name = push_file(conn, file, file.filename, dir_path)

            results.append({
                "filename": file.filename,
                "stored_filename": stored_name,
                "success": True,
                "skipped": False,
                "location": f'{dir_path}/{stored_name}'
            })
        except Exception as e:
            results.append({
                "filename": file.filename,
                "success": False,
                "skipped": False,
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
