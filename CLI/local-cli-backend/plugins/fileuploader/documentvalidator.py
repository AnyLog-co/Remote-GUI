from fastapi import UploadFile
from typing import Dict, List


async def validate_file(file: UploadFile) -> Dict[str, bool | List[str]]:
    """Check if the document file is valid"""
    result: Dict[str, bool | List[str]] = {"valid": True, "errors": []}

    # Check if user selected a file
    if not file.filename or file.filename.strip() == "":
        result["valid"] = False
        result["errors"].append("No file selected")
        return result

    return result