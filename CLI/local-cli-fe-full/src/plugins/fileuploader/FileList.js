import React, { useState, useRef } from 'react';
import '../../styles/FileuploaderPage.css';

function FileList({ files, nameConflictObject, handleDeleteButtonClick, handleRename }) {

  // only one state needed to handle renaming of one file
  const inputRef = useRef();
  const [activeFile, setActiveFile] = useState(null);
  const [activeValue, setActiveValue] = useState("");

  const getFileExtensionEmoji = (fileName) => {
    const fileExtension = fileName.split('.').pop();
    
    // https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Image_types
    const imageExtension = ['apng', 'png', 'avif', 'gif', 'jpg', 'jpeg', 'jfif',
      'pjpeg', 'pjp', 'svg', 'webp', 'bmp', 'ico', 'cur', 'tif', 'tiff'
    ];

    // https://www.geeksforgeeks.org/techtips/text-file-formats/
    const textExtension = ['asc', 'doc', 'docx', 'rtf', 'msg', 'pdf', 'txt', 'wpd', 'wps'];

    if (imageExtension.includes(fileExtension)) return '🖼️';
    else if (textExtension.includes(fileExtension)) return '📄';
    else {
      return '';
    }
  }

  const handleChange = (event) => {
    setActiveValue(event.target.value);
  }

  return (
    <React.Fragment>
      {files.map((file) => (
        <div 
          key={file.id}
          className={`file-list-item-container 
              ${file.file.name in nameConflictObject ? "file-list-item-duplicate" : ""}`}
        >
          <div className="file-list-item-info">
            <div className="uns-item-icon">
              {getFileExtensionEmoji(file.file.name)}
            </div>
            <div 
              className="file-list-item-name-container"
              title={file.file.name}
            >
              <input
                ref={activeFile === file.id ? inputRef : null}
                type="text"
                className="file-list-item-name"
                value={activeFile === file.id ? activeValue : file.file.name}
                onChange={handleChange}
                onFocus={() => {
                  setActiveValue(file.file.name);
                  setActiveFile(file.id);
                }}
                onKeyDown={(e) => {if (e.key === "Enter") {
                  inputRef.current.blur();
                  handleRename(file.id, file.file.name, activeValue);
                  setActiveFile(null);
                }}}
                onBlur={() => {
                  handleRename(file.id, file.file.name, activeValue);
                  setActiveFile(null);
                }}  
              />
            </div>
            <div className="file-list-item-actions">
              <button
                className="file-list-item-delete-btn"
                onClick={() => handleDeleteButtonClick(file.id)}
                title={`Remove selected file ${file.file.name}`}
                aria-label={`Remove selected file ${file.file.name}`}
              >
                ❌
              </button>
            </div>
          </div>
          {file.result && (file.result.success ?
          <div className="file-list-item-success">
            Stored as: {file.result.location}
          </div>
          :
          <div className="file-list-item-error">
            Error(s): {file.result.errors.map((error) => `${error}\n`)}
          </div>
          )}
        </div>
      ))}
    </React.Fragment>
  );
};

export default FileList;