import React, { useState, useEffect, useRef } from 'react';
import '../../styles/FileuploaderPage.css';
import FileList from './FileList';
import FileDropzone from './FileDropzone';
import SelectDirectory from './SelectDirectory';

const API_URL = window._env_?.REACT_APP_API_URL || "http://localhost:8000";

function FileuploaderPage({ node }) {

  const [files, setFiles] = useState([]);
  const changeFiles = (newFiles) => setFiles((prevState) => [...prevState, ...newFiles]);

  const defaultDirectory = "/app/AnyLog-Network/data/upload_dir";
  const [directory, setDirectory] = useState({label: defaultDirectory, value: defaultDirectory});
  const [isValidDirectory, setIsValidDirectory] = useState(true);

  const [canSubmit, setCanSubmit] = useState(false);
  const [canDeleteUploaded, setCanDeleteUploaded] = useState(false);

  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const [loading, setLoading] = useState(false); // upload button
  const [loadingDeleteUploaded, setLoadingDeleteUploaded] = useState(false);

  // upload button becomes valid if there are files selected
  useEffect(() =>{
    if (files.length > 0)
      setCanSubmit(true);
    else 
      setCanSubmit(false);
  }, [files]);

  // validate directory
  useEffect(() => {
    if (directory?.label?.includes("..")) 
      setIsValidDirectory(false);
    else
      setIsValidDirectory(true);
    console.log(directory, isValidDirectory);
  }, [directory]);

  // remove individual file
  const handleDeleteButtonClick = (id) => {
    const index = files.findIndex((element) => element.id === id);
    files.splice(index, 1);
    setFiles([...files]);
  }

  // remove all successfully uploaded buttons (instead of deleting them manually)
  const handleDeleteUploadedButtonClick = () => {
    setLoadingDeleteUploaded(true);
    for (let i = files.length - 1; i >= 0; i--) {
      if (files[i].result?.success) {
          files.splice(i, 1);
      }
    }
    setFiles([...files]);
    setCanDeleteUploaded(false);
    setLoadingDeleteUploaded(false);
  }

  const handleUploadButtonClick = async () => {
    if (files.length > 0) {
      try {
        setLoading(true);
        setError(null);
        setSuccess(null);
        
        const formData = new FormData();
        formData.set("conn", node);
        files.forEach((file) => {
          formData.append("files", file.file);
        })

        const response = await fetch(`${API_URL}/fileuploader/upload`, {
          method: "POST",
          body: formData
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.detail || `HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        // add upload result to each file to be displayed in the file list
        // if there is a successful file, allow it to be deleted
        let hasSuccess = false;
        const filesWithResult = files.map((file, index) => {
          if (data.results[index].success)
            hasSuccess = true;
          return ({
            ...file,
            result: data.results[index],
          });
        });
        setFiles(filesWithResult);
        if (hasSuccess)
          setCanDeleteUploaded(true);
        
        // array of strings to hold each line
        setSuccess([`Total files: ${data.total_files}`,
          `Number of files successfully uploaded: ${data.successful}`,
          `Number of files failed to be uploaded: ${data.failed}`,
        ]);
      } catch (err) {
        setError(err.message || 'Failed to upload files');
      } finally {
          setLoading(false);
      }
    }
  }

  // get correct title for upload button when you hover over it
  const getUploadButtonTitle = () => {
    if (!isValidDirectory) {
      return "You must select a valid directory to upload your files";
    } else if (!canSubmit) {
      return "You must select at least one file to upload";
    } else {
      return "Upload all selected files";
    }
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

      <div className="fileuploader-form">

        <div className="form-section">
          <h3>Configuration</h3>
          <div className="form-group">
            <span>Destination folder: {directory ? `${directory?.label}` : "Not selected"}</span>
            <div className="form-row">
              <button
                className="reset-button"
                onClick={() => setDirectory({label: defaultDirectory, value: defaultDirectory})}
              >
                Reset to Default
              </button>
            </div>
            <span>Choose upload directory (one will be created if it doesn't exist)</span>
            <SelectDirectory
              defaultDirectory={defaultDirectory}
              setDirectoryCallback={setDirectory}
            />
            {!isValidDirectory &&
              <small className="form-text text-muted select-error">
                Upload directory cannot contain ".."
              </small>
            }
          </div>
        </div>

        <div className="form-section">
          <h3>File Drop Zone</h3>
          <FileDropzone setFilesCallback={changeFiles}/>
        </div>

        <div className="form-section">
          <div
            className="file-list-container form-group"
          >
            <div className="file-list-container-header">
              Files selected ({files.length})
            </div>
            <div className="file-list-content">
              <FileList 
                files={files}
                handleDeleteButtonClick={handleDeleteButtonClick}
              />
            </div>
          </div>

          <div
            className="form-row"
          >
            <button 
              className="delete-button"
              disabled={!canDeleteUploaded}
              title={!canDeleteUploaded ? "You must have successfully uploaded at least one file" : "Delete all successfully uploaded files"}
              onClick={handleDeleteUploadedButtonClick}
            >
              {loadingDeleteUploaded ? "Removing Uploaded..." : "Remove All Uploaded"}
            </button>

            <button 
              className="delete-button"
              disabled={!canSubmit}
              title={!canSubmit ? "You must select files in order to delete all of them" : "Delete all selected files"}
              onClick={() => {setFiles([])}}
            >
              Delete All
            </button>
          </div>
        </div>

        <button 
          className="upload-button"
          disabled={!canSubmit || !isValidDirectory}
          title={getUploadButtonTitle()}
          onClick={handleUploadButtonClick}
        >
          {loading ? "Uploading..." : "Upload"}
        </button>

        {error && (
          <div className="error-message">
            <strong>Error:</strong>
            {error}
          </div>
        )}

        {success && (
          <div className="success-message">
            <strong>Result: </strong>
            {success.map((line) => `\n${line}`)}
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
