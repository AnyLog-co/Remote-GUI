from fastapi import APIRouter, File, UploadFile, HTTPException
from pydantic import BaseModel
from typing import Dict, List
import shutil
import uuid
from pathlib import Path
from .documentvalidator import validate_file
import requests

# Create the API router
api_router = APIRouter(prefix="/fileuploader", tags=["File Uploader"])

# Create upload directory
UPLOAD_DIR = Path("upload_dir")

# API endpoints
@api_router.get("/")
async def fileuploader_info():
    """Get File Uploader information"""
    return {
        "name": "File Uploader Plugin",
        "version": "1.0.0",
    }

@api_router.post("/upload-single")
async def add_file(file: UploadFile = File(...)) -> Dict[str, str | int | None]:
    """Upload a file"""
    if file.filename == "" or file.filename is None:
        raise HTTPException(status_code=400, detail="No file selected")
    
    # create upload directory even if it exists
    UPLOAD_DIR.mkdir(exist_ok=True)
    file_path = UPLOAD_DIR / file.filename

    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    return {
        "filename": file.filename,
        "content_type": file.content_type,
        "size": file.size,
        "location": str(file_path)
    }

@api_router.post("/upload")
async def add_files(files: List[UploadFile] = File(...)) -> Dict[str, int | List[Dict[str, str | bool | List[str] | None]]]:
    """Upload a list of files to the upload directory"""
    
    results: List[Dict[str, str | bool | List[str] | None]] = []
    
    UPLOAD_DIR.mkdir(exist_ok=True)
    for file in files:
        validation = await validate_file(file)

        if not validation['valid']:
            results.append({
                "filename": file.filename,
                "success": False,
                "errors": validation["errors"]
            })
            continue

        filename = Path(file.filename).stem
        file_ext = Path(file.filename).suffix

        # format: filename-uuid.[file-extension]
        unique_filename = f"{filename}-{uuid.uuid4()}{file_ext}"
        file_path = UPLOAD_DIR / unique_filename

        try:
            with open(file_path, "wb") as buffer:
                shutil.copyfileobj(file.file, buffer)

            results.append({
                "filename": file.filename,
                "stored_filename": unique_filename,
                "success": True,
                "location": str(file_path)
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
