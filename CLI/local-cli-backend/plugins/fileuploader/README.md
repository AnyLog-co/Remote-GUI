# Drag-and-Drop File Uploader Plugin API

An API built with **FastAPI** that allows users to upload their files to a node and directory of their choosing.

---

## Endpoints

`POST /fileuploader/get-directories`: Allows users to see which directories exist under a given path

- Used for the folder search component
- Parameters: `getDirectoriesRequest`
  - `conn: str` - the desired node to perform the search
  - `directory_path: str` - a string representing the desired directory path to search for existing directories
- Returns: `List[str]`
  - a list of existing path strings of the directories in `directory_path`
- Constraints:
  - `directory_path` must start with `/app/`
  - `directory_path` must be a valid path
  - `directory_path` cannot contain the substring `..` (preventing access of directories outside `/app`)

`POST /fileuploader/upload`: Allows users to upload files in a given upload directory

- Called by the file uploader's `Upload` button
- Parameters:
  - `files: List[UploadFile] = File(...)` - a list of files using FastAPI's UploadFile class
  - `duplicateHandlingOptions: List[str] = Form(...)` - a list of strings that correspond to `files`, specifying how the server should handle conflicting file names
  - `conn: str = Form(...)` - the desired node to perform the search
  - `dir: str = Form(...)` - a string representing the desired directory path to search for existing directories
- Returns: `Dict[str, int | List[Dict[str, str | bool | List[str] | None]]]`
  - "total_files" - number of files sent to be uploaded
  - "successful" - number of files successfully uploaded
  - "failed" - number of files that failed to be uploaded
  - "results" - a list of dictionaries representing the outcome of each file's attempted upload. Each dictionary may have some of the following key-value pairs:
    - "filename" - name of the file as sent in the request
    - "stored_filename" - if the file was successfully uploaded, this is the name of the file as stored in the directory
    - "success" - a Boolean that says if the file upload was a success
    - "skipped" - a Boolean that says if the file upload attempt was skipped (which may happen if a file with the same name already exists in the directory, and the "skip" option was selected in `duplicateHandlingOptions`)
    - "location" - if the file was successfully uploaded, this is the full path name to the file, including the name it was stored as
    - "errors" - a list of any error messages
- Constraints:
  - `directory_path` must start with `/app/`
  - `directory_path` must be a valid path
  - `directory_path` cannot contain the substring `..` (preventing access of directories outside `/app`)

---

