# Drag-and-Drop File Uploader Plugin

A frontend plugin that allows users to drag and drop files for uploading, with configurations for selecting the target directory, managing and renaming files, and handling the upload of files with the same name.

---

## Architecture

1. **`FileuploaderPage.js`** - Main React component for the user interface
2. **`fileuploader_api.js`** - Default `refresh_frontend_apis.py` generated API client functions for communicating with the backend
3. **`FileDropzone.js`** - React component for the file drag-and-drop UI using **react-dropzone**
4. **`SelectDirectory.js`** - React component of a search and live dropdown menu for helping users to choose a directory, using **react-select**
5. **`FileList.js`** - React component for listing all files that have been selected by the user, allowing renaming, deletion, and other configurations

---

## UI Sections

### Search Folder

Users can select a directory using a search bar that actively lists out the current directory as a user is typing out the path.
- The default directory is `/app/AnyLog-Network/data/upload_dir`
- Users may only make directories within `/app`
- The dropdown menu results puts matching directory names at the top, followed by the rest of the existing directories
- The topmost menu item allows the user to create a directory if it does not show up in the list ("Create [directory]")
- The user may select the gray `Reset to Default` button to reset the directory back to the default directory

The input does not allow users to upload to directory paths that:
- Don't start with `/app/`
- Have spaces
- Have `..` anywhere in the path (so that users cannot select a directory outside `/app`)

### File Drop Zone

Users can drag and drop any types of files and any number of files into the drop zone, or select the zone to upload instead.
- Folders may not be uploaded, and the zone will instead extract and upload all the files that are anywhere inside the folder

### File List View

Files uploaded through the zone can be viewed in a scrollable list, with configurations inside and outside the list.

#### List

Files are listed in the order that they were uploaded, and allow user interactions.
- The header for the list shows the number of files selected
- Files may have an icon on the left, indicating the type of file it is
- The file name includes the extension, and can be renamed (but the type or file extension cannot be changed)
- The file's duplicate file handling options can be configured, which is explained [below](#Existing-File-or-Duplicate-File-Handling-Configuration)
- The user can click the X (❌) button to remove the file from the list and from uploading
- Success or error messages are displayed under each file in the list after the user attempts to upload

File naming constraints:
- The list does not allow files with the same name, and conflicting files must be deleted or renamed by clicking on the file name
- If there are naming conflicts, a warning above the file list will be displayed, stating the conflicting files
- Conflicting files are also outlined in red
- Users may not change the type of file by renaming it with a different extension, and any attempts will simply append the file extension on the new name
- File names with spaces may not be uploaded

#### Existing/Duplicate File Handling Configuration

If a file with the same name already exists in the upload destination directory, the user may choose what each source file should do:
- **Skip** uploading the source file
- **Replace** the existing destination file with the source file, if it exists
- **Keep** both files, where the file in the existing directory stays if it exists, and the uploaded file is appended a number (e.g. `test-1.txt`) to distinguish it from any existing file(s) (if there is a `test-2.txt` file as well, then the uploaded file will be named `test-3.txt`, and etc.)

The skip option is set by default, so that users can observe any possible duplicate file conflicts after attempting to upload the files

If the user wants to choose the same option for multiple files instead of individually:
- There are three gray buttons that have the options above, and clicking them will apply the option to **all** files in the list
- Files may still be configured individually even after clicking one of these buttons

Users are still allowed to rename files manually instead of picking one of these three options.

#### File Deletion Settings

If the user wants to delete multiple files at once, there are two ways that make use of the red buttons below the file list:
- `Remove All Uploaded` allows the user to remove all successfully uploaded files, keeping any files that failed to upload
- `Delete All` deletes all files in the list, regardless of if they failed or were successful in uploading

### Upload Button

An upload button that can be clicked once the user has chosen an upload directory, uploaded files, and resolved any conflicts
- If the request to upload is successful, a green message is displayed below
- The green message displays the number of files sent, the number of files successfully uploaded, and the number of files that failed to upload
- The green message does not necessarily indicate a successful upload of all files
- An error message is displayed if the request to upload failed, while individual files in the file list may have their own error messages

---

## Components

### `FileuploaderPage`

The main component that uses all of the components below in the following sections:
- The **Search Folder** section uses the `SelectDirectory` component
- The **File Drop Zone** section uses the `FileDropzone` component
- The **File List View** section uses the `FileList` component

### `FileDropzone`

The drag-and-drop component that uses `react-dropzone` to handle file uploads from the user.
- The zone reacts to the user dragging files over
- Files that are uploaded update the file list state in the `FileuploaderPage` component, which is then sent to the `FileList` component for viewing

### `FileList`

The component that is responsible for displaying the files that were uploaded using the `FileDropzone` component
- The functionality is described [above](#File-List-View)

### `SelectDirectory`

The component that uses `react-select` to help the user search for a directory to upload in
- Loading the directories is triggered every time a user types in a `/` in the path
- Otherwise, the dropdown menu of directories is sorted without loading in the directories again
- The component will only detect a user selecting a directory by selecting from the dropdown menu, not by unfocusing
- The `Destination folder:` above will be updated accordingly

---

## Error Handling

### Search Folder

As stated [here](#Search-Folder), directory paths must start with `/app/`, not have spaces, and not have `..`.
- If a user attempts to create an invalid directory, a warning below the search bar is displayed, the `Destination folder:` becomes red, and the user will be prevented from uploading

### File List View

File naming constraints are described [here](#List).
- If there are naming conflicts, a warning above the file list will be displayed, stating the conflicting files
- Conflicting files are also outlined in red
- The user will be unable to upload if there are conflicting files

If a file has the `Skip` option selected and a user attempts to upload when a file with the same name exists in the upload directory, a warning message will be displayed. Otherwise, error messages may be displayed, such as a failure to upload.

### Upload Button

The upload button may be disabled for the following reasons:
- The user has not selected a valid directory
- The user has not selected any files (so the file list is empty)
- The user has naming conflicts with the files that were selected (so the user must delete or rename files)

---

## Dependencies

The `npm` packages installed for this plugin are as follows:
- `react-dropzone` ^14.4.0 ([Link](https://www.npmjs.com/package/react-dropzone))
- `react-select` ^5.10.2 ([Link](https://www.npmjs.com/package/react-select))
