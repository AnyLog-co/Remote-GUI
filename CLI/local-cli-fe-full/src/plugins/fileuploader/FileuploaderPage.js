import React, {useState, useEffect} from 'react';
import '../../styles/FileuploaderPage.css';
import FileList from './FileList';
import FileDropzone from './FileDropzone';

function FileuploaderPage({ node }) {

  const [files, setFiles] = useState([]);
  const changeFiles = (newFiles) => setFiles((prevState) => [...prevState, ...newFiles]);

  const [canSubmit, setCanSubmit] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  // upload button becomes valid if there are files selected
  useEffect(() =>{
    if (files.length > 0) setCanSubmit(true);
    else setCanSubmit(false);
  }, [files]);

  const handleDeleteButtonClick = (id) => {
    const index = files.findIndex((element) => element.id === id);
    files.splice(index, 1);
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

      <div className="fileuploader-form">
        <div className="form-section">
          <h3>File Drop Zone</h3>
          <FileDropzone setFilesCallback={changeFiles}/>
        </div>

        <div className="form-section">
          <div
            className="file-list-container"
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
        </div>

        <button 
          className="upload-button"
          disabled={!canSubmit}
          title={!canSubmit ? "You must select at least one file to upload" : "Upload all selected files"}
        >
          {loading ? "Uploading..." : "Upload"}
        </button>

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
