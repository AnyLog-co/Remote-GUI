from pathlib import Path
from fastapi import UploadFile
from typing import Dict, List

class DocumentValidator:
    def __init__(self, max_size: int = 10 * 1024 * 1024):  # 10MB default
        self.max_size = max_size

    async def validate_file(self, file: UploadFile) -> Dict[str, bool | List[str]]:
        """Check if the document file is valid"""
        result: Dict[str, bool | List[str]] = {"valid": True, "errors": []}

        # Check if user selected a file
        if not file.filename or file.filename.strip() == "":
            result["valid"] = False
            result["errors"].append("No file selected")
            return result

        # Read file to check size
        content = await file.read()
        await file.seek(0)  # Reset file pointer for later use

        # Check file size
        file_size = len(content)
        if file_size > self.max_size:
            result["valid"] = False
            result["errors"].append(
                f"File too large ({file_size:,} bytes). Maximum: {self.max_size:,} bytes"
            )

        return result