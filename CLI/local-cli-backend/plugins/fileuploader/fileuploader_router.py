from fastapi import APIRouter
from pydantic import BaseModel

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
