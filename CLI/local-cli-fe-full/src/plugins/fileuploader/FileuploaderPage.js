import React, {useState, useCallback, useMemo} from 'react';
import {useDropzone} from 'react-dropzone';
import '../../styles/FileuploaderPage.css';

// from https://react-dropzone.js.org/#!/Examples
const focusedStyle = {
  borderColor: '#2196f3',
  transition: 'border .24s ease-in-out'
};

const activeStyle = {
  borderColor: '#2196f3',
  backgroundColor: '#e2e4e8',
  color: '#a1a8b0',
  transition: 'background-color .12s ease-in-out, border .24s ease-in-out'
};

function FileuploaderPage({ node }) {

  const [files, setFiles] = useState([]);

  const [canSubmit, setCanSubmit] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const onDrop = useCallback(acceptedFiles => {
    setCanSubmit(true);
    setFiles([...files, ...acceptedFiles]);
  }, [files])
  const {
    getRootProps,
    getInputProps,
    isFocused,
    isDragActive
  } = useDropzone({onDrop})

  const style = useMemo(() => ({
    ...(isFocused ? focusedStyle : {}),
    ...(isDragActive ? activeStyle : {}),
  }), [
    isFocused,
    isDragActive
  ]);

  const getFileExtensionEmoji = (fileName) => {
    const fileExtension = fileName.split('.').pop();
    
    // https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Image_types
    const imageExtension = ['apng', 'png', 'avif', 'gif', 'jpg', 'jpeg', 'jfif',
      'pjpeg', 'pjp', 'svg', 'webp', 'bmp', 'ico', 'cur', 'tif', 'tiff'
    ];

    console.log(fileExtension);

    if (imageExtension.includes(fileExtension)) {
      return '🖼️';
    } else {
      return '📁';
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
          <div
            className="file-dropzone"
            {...getRootProps({style})}
          >
            <input {...getInputProps()} />
              <p className={isDragActive ? "drag-active" : "drag-inactive"}>
                Drop the file(s) here ...
              </p> 

              <p className={isDragActive ? "drag-inactive" : "drag-active"}>
                Drag-and-drop files here, or click to select files
              </p>
          </div>
        </div>

        {files.length > -1 &&
          <div className="form-section">
            <div
              className="file-list-container"
            >
              <div className="file-list-container-header">
                Files selected ({files.length})
              </div>
              <div className="file-list-content">
                {files.map((file) => (
                  <div className="file-list-item">
                    <div className="uns-item-icon">
                      {getFileExtensionEmoji(file.name)}
                    </div>
                    <div className="file-list-item-name">
                      {file.name}
                    </div>
                    <div className="file-list-item-actions">
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        }

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
