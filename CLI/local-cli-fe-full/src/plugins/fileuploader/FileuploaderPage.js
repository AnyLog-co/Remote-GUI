import React, { useState, useEffect, useRef, useMemo } from 'react';
import '../../styles/FileuploaderPage.css';
import FileList from './FileList';
import FileDropzone from './FileDropzone';
import SelectDirectory from './SelectDirectory';

const API_URL = window._env_?.VITE_API_URL || "http://localhost:8000";

function FileuploaderPage({ node }) {

  const [files, setFiles] = useState([]);
  const appendFiles = (newFiles) => setFiles((prevState) => [...prevState, ...newFiles]);
  const [filesQueue, setFilesQueue] = useState([]);

  const defaultDirectory = "/app/AnyLog-Network/data/upload_dir";
  // const [directory, setDirectory] = useState({label: defaultDirectory, value: defaultDirectory});
  const [directory, setDirectory] = useState(defaultDirectory);
  const [isValidDirectory, setIsValidDirectory] = useState(true);
  const [directoryError, setDirectoryError] = useState("");

  // "hashtable" representation of file names
  const [nameConflictObject, setNameConflictObject] = useState({});
  const filenamesInfo = useMemo(() => {
    const list = Object.keys(nameConflictObject);
    return {
      list: list,
      length: list.length,
      maxDisplayed: 10,
    }
  }, [nameConflictObject]);
  const [hasConflicts, setHasConflicts] = useState(false);
  const [canSubmit, setCanSubmit] = useState(false);

  const [numberSelected, setNumberSelected] = useState(0);

  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [successFiles, setSuccessFiles] = useState(null);

  // upload buttons (with string of button name)
  const [loadingButton, setLoadingButton] = useState('');

  const [displaySizeWarning, setDisplaySizeWarning] = useState(false);

  // select all button value
  const [selectAllChecked, setSelectAllChecked] = useState(false);

  // for size warning modal
  const modalRef = useRef();

  // upload button becomes valid if there are files selected
  // also checks for duplicate file names
  // triggered by FileDropzone.js and FileList.js
  useEffect(() => {

    // build duplicates object
    const names = {};
    const duplicates = {};
    let numSelections = 0;
    let hasDuplicates = false;
    for (const file of files) {

      // names keeps track of current namespace
      // duplicates keeps track of which names have duplicates
      const name = file.file.name;
      if (name in names) {
        duplicates[name] = 1;
        hasDuplicates = true;
      }
      else
        names[name] = 1;

      // check if a file is selected
      if (file.selected) {
        numSelections += 1;
      }
    }
    
    if (files.length > 0 && numSelections > 0)
      setCanSubmit(true);
    else
      setCanSubmit(false);

    // if any file is selected, the select all checkbox will be checked
    // this allows for everything to be deselected easily
    numSelections > 0 ? setSelectAllChecked(true) : setSelectAllChecked(false);

    hasDuplicates ? setHasConflicts(true) : setHasConflicts(false);
    
    setNameConflictObject({...duplicates});
    setNumberSelected(numSelections);
  }, [files]);

  // directory validation every time it changes (triggered by buttons and SelectDirectory.js)
  useEffect(() => {
    const appCheckRegex = /^\/app\/.*$/;
    const filePathRegex = /^\/app(\/([^/\s]+))*\/?$/;
    // allowSpaces = ^\/app((\/'[^\/]*')|(\/"[^\/]*")|(\/[^\/ ]+))*\/?$

    if (!appCheckRegex.test(directory)) {
      setIsValidDirectory(false);
      setDirectoryError("Upload folder path must start with /app/");
    }
    else if (!filePathRegex.test(directory)) {
      setIsValidDirectory(false);
      setDirectoryError("Invalid folder path (cannot contain consecutive /'s, '..', or spaces)");
    }
    else if (directory.includes("..")) {
      setIsValidDirectory(false);
      setDirectoryError("Upload folder path cannot contain '..'");
    }
    else
      setIsValidDirectory(true);
  }, [directory]);

  useEffect(() => {

    // Close modal on outside click
    const handleClickOutside = (e) => {
      if (modalRef.current && !modalRef.current.contains(e.target)) {
        setDisplaySizeWarning(false);
      }
    };

    // close modal on key press
    const handleKeyDown = (e) => {
      if (e.key === "Escape")
        setDisplaySizeWarning(false);
    };


    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  // remove individual file (prop used by FileList.js)
  const handleDeleteButtonClick = (id) => {
    const index = files.findIndex((element) => element.id === id);
    files.splice(index, 1);
    setFiles([...files]);
  };

  // remove multiple files selected at once
  const handleDeleteSelected = () => {
    const newFiles = files.filter((file) => !file.selected);
    setFiles([...newFiles]);
  };

  // rename individual file (prop used by FileList.js)
  const handleRename = (id, oldName, newName) => {
    const index = files.findIndex((element) => element.id === id);

    // remove spaces
    newName = newName.replaceAll(' ', '');

    // check for file extension matching, append correct file extension if it doesn't match
    const oldFileExtension = oldName.split('.').pop();
    const newFileExtension = newName.split('.').pop();
    if (oldFileExtension !== newFileExtension) {
      newName = newName.concat(`.${oldFileExtension}`);
    }

    files[index].file = new File([files[index].file], newName, {type: files[index].file.type});
    setFiles([...files]);
  };

  // change if individual file should be selected
  // (prop used by FileList.js)
  const changeSelection = (id, newValue) => {
    const index = files.findIndex((element) => element.id === id);
    files[index].selected = newValue;
    setFiles([...files]);
  };

  const getUploadResponse = async (selectedFiles, duplicateHandlingOption) => {
    const formData = new FormData();
    formData.set("conn", node);
    formData.set("directory_path", directory);
    selectedFiles.forEach((file) => {
      formData.append("files", file.file);
      formData.append("duplicateHandlingOptions", duplicateHandlingOption);
    })

    const response = await fetch(`${API_URL}/fileuploader/upload`, {
      method: "POST",
      body: formData
    });

    return response;
  }

  const getLargeFileCount = (fileList) => {
    const largeFileSize = 10 * 1024 * 1024; // 10 MB
    const largeFiles = fileList.filter(file => file.file.size >= largeFileSize);
    return largeFiles.length;
  }

  const handleUpload = async (fileList = files, isFirstAttempt = false, overrideSizeWarning = false, duplicateHandlingOption) => {
    if (fileList.length > 0) {

      // User should confirm they're ok with uploading large files
      const largeFileCount = getLargeFileCount(fileList);
      if (largeFileCount > 0 && !overrideSizeWarning) {
        setFilesQueue(fileList);
        setDisplaySizeWarning(true);
        return;
      }
      setDisplaySizeWarning(false);

      try {
        setLoadingButton(duplicateHandlingOption);
        setError(null);
        setSuccess(null);
        setSuccessFiles(null);
        
        // keep track of selected files and files that weren't selected
        // also keep track of indices to maintain order of files after upload
        // mapping fileList index to selectedFiles index
        const selectedFiles = [];
        const selectedIndexObject = {};
        let selectedIndex = 0;
        fileList.forEach((file, index) => {
          if (isFirstAttempt || file.selected) {
            selectedFiles.push(file);
            selectedIndexObject[index] = selectedIndex;
            selectedIndex++;
          }
        });

        const response = await getUploadResponse(selectedFiles, duplicateHandlingOption);

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.detail || `HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        // add upload result to each file to be displayed in the file list
        // if there is a successful file, move it to success list
        // non-selected or failing files get put into the other list
        const successful = [];
        const otherFiles = [];

        fileList.forEach((file, index) => {
          if (selectedIndexObject.hasOwnProperty(index)) {
            const result = data.results[selectedIndexObject[index]];
            if (result.success)
              successful.push(`${file.file.name} was stored as ${result.stored_filename}`)
            else
              otherFiles.push({
                ...file,
                firstAttempt: false,
                result: result,
              });
          } else
            otherFiles.push({
              ...file,
              firstAttempt: false,
            });
        });
        if (isFirstAttempt)
          appendFiles(otherFiles);
        else
          setFiles(otherFiles);
        setSuccessFiles(successful);
        
        // array of strings to hold each line
        setSuccess([`Total files: ${data.total_files}`,
          `Number of files successfully uploaded: ${data.successful}`,
          `Number of files failed to be uploaded: ${data.failed}`,
        ]);
      } catch (err) {
        setError(err.message || 'Failed to upload files');
      } finally {
        setLoadingButton('');
      }
    }
  };

  const handleSizeWarningAccept = async () => {
    handleUpload(filesQueue, true, true, 'skip');
    setFilesQueue([]);
  }

  // get correct title for upload button when you hover over it
  const getUploadButtonTitle = (duplicateHandlingOption) => {
    if (!isValidDirectory) {
      return "You must select a valid directory to upload your files";
    } else if (!canSubmit) {
      return "You must select at least one file to upload";
    } else if (hasConflicts) {
      return "You must resolve the duplicate file names to upload";
    } else if (duplicateHandlingOption === 'overwrite') {
      return "Upload all selected files, overwriting the duplicate files in the upload directory";
    } else if (duplicateHandlingOption === 'keep') {
      return "Upload all selected files, appending them with a number in the upload directory";
    } else {
      return "Upload all selected files";
    }
  };

  // update file list
  // (prop used by FileDropzone.js)
  const handleFileDrop = (newFiles) => {
    handleUpload(newFiles, true, false, 'skip');
  }

  const handleSelectAll = () => {
    files.forEach((file) => file.selected = !selectAllChecked);
    setSelectAllChecked(!selectAllChecked);
    setFiles([...files]);
  }

  return (
    <div className="fileuploader-page">
      <div className="fileuploader-header">
        <h2>File Uploader</h2>
        {node && (
          <div className="selected-node-info">
            <span className="node-label">Node:</span>
            <span className="node-value">{node}</span>
          </div>
        )}
      </div>

      {displaySizeWarning ?
        <div className="sizewarning-container">
          <div 
            ref={modalRef}
            className="sizewarning-body"
          >
            <div className="sizewarning-text">
              At least one file is larger than 10 MB. Please confirm
              to proceed.
            </div>
            <div className="sizewarning-options">
              <button className="upload-button" onClick={handleSizeWarningAccept}>
                Upload
              </button>
              <button className="upload-button" onClick={() => setDisplaySizeWarning(false)}>
                Go Back
              </button>
            </div>
          </div>
        </div>
        : <></>
      }

      <div className="fileuploader-form">

        {/* Search for directory using react-select */}
        <div className="form-section">
          <h3>Search Folder</h3>
          <div className="form-group">
            <span
              className={`inline-span ${!isValidDirectory ? "error-text-color" : ""}`}
            >
              <button
                className="reset-button"
                title={`Reset to default upload folder ${defaultDirectory}`}
                onClick={() => setDirectory(defaultDirectory)}
              >
                &#8635;
              </button>
              Destination folder: {directory}
            </span>
            <span>Choose upload folder starting with /app/. There is an option to create a folder if it doesn't exist.</span>
            <SelectDirectory
              node={node}
              defaultDirectory={defaultDirectory}
              setDirectoryCallback={setDirectory}
            />
            {!isValidDirectory &&
              <small className="form-text text-muted select-error">
                {directoryError}
              </small>
            }
          </div>
        </div>

        {/* Drag and Drop functionality through react-dropzone */}
        <div className="form-section">
          <h3>File Drop Zone</h3>
          <FileDropzone setFilesCallback={handleFileDrop}/>
        </div>


        {/* Configure file settings if there exist duplicate file names, and file view with deletion settings */}
        <div 
          className={`form-section expandable ${files.length > 0 ? 'expanded' : ''}`}
        >
          <h3
            className={`expandable ${files.length > 0 ? 'expanded' : ''}`}
          >Handle duplicate file names</h3>
          <div className="form-group">
            <span>The following file names already exist in the upload directory. You can rename or ignore these files, 
              or choose what happens to files with the same name in the upload directory.</span>
            {/* Limit number of duplicate file name conflicts to filenamesInfo.maxDisplayed */}
            {hasConflicts &&
              <span
                className="form-group error-text-color"
              >
                There are files that have duplicate names. You must remove the duplicate files or rename them by clicking on the file name. 
                Check the files with these names:
                {filenamesInfo.list.slice(0, filenamesInfo.maxDisplayed).map(
                  (line) => `\n- ${line}`
                )}
                {filenamesInfo.length > filenamesInfo.maxDisplayed ?
                  `\n...and ${filenamesInfo.length - filenamesInfo.maxDisplayed} more`
                : ''
                } 
              </span>
            }
          </div>
          <div
            className="file-list-container form-group"
          >
            <div className="file-list-container-header">
              <div
                className="file-list-container-header-info"
              >
                <input
                  type="checkbox"
                  title={selectAllChecked ? "Click to deselect all files" : "Click to select all files"}
                  checked={selectAllChecked}
                  onChange={() => handleSelectAll()}
                  className="file-list-item-icon checkbox"
                />
              </div>
              {numberSelected} of {files.length} files selected
            </div>
            <div className="file-list-content">
              <FileList 
                files={files}
                nameConflictObject={nameConflictObject}
                handleDeleteButtonClick={handleDeleteButtonClick}
                handleRename={handleRename}
                changeSelection={changeSelection}
              />
            </div>
          </div>

          <div
            className="form-row"
          >
            <button 
              className="upload-button"
              disabled={!canSubmit || !isValidDirectory || hasConflicts || (loadingButton !== '' && loadingButton !== 'overwrite')}
              title={getUploadButtonTitle('overwrite')}
              onClick={() => handleUpload(files, false, true, 'overwrite')}
            >
              {loadingButton === "overwrite" ? "Uploading..." : "Overwrite All Files"}
            </button>
            <button 
              className="upload-button"
              disabled={!canSubmit || !isValidDirectory || hasConflicts || (loadingButton !== '' && loadingButton !== 'keep')}
              title={getUploadButtonTitle("keep")}
              onClick={() => handleUpload(files, false, true, 'keep')}
            >
              {loadingButton === "keep" ? "Uploading..." : "Keep All Files"}
            </button>
            <button 
              className="delete-button"
              disabled={!canSubmit || !isValidDirectory || hasConflicts || loadingButton !== ''}
              title={!canSubmit ? "You must select files in order to delete all of them" : "Ignore all selected files and remove them from view"}
              onClick={() => handleDeleteSelected()}
            >
              Ignore
            </button>
          </div>
        </div>

        {loadingButton === 'skip' && files.length === 0 && (
          <div className="uploading-message">
            <strong>Uploading...</strong>
          </div>
        )}

        {error && (
          <div className="error-message">
            <strong>Error:</strong>
            {error}
          </div>
        )}

        {success && successFiles.length > 0 && (
          <div className="success-message">
            <strong>Result: </strong>
            {success.map((line) => `\n${line}`)}
            {'\n\n'}
            <strong>Successfully uploaded files: </strong>
            {successFiles.map((line) => `\n- ${line}`)}
          </div>
        )}

      </div>
    </div>
  )
}

// Plugin metadata - used by the plugin loader
export const pluginMetadata = {
  name: 'File Uploader',
  icon: null,
};

export default FileuploaderPage;
