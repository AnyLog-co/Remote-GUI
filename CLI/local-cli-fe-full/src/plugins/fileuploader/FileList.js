import React, { useState, useRef } from 'react';
import '../../styles/FileuploaderPage.css';

function FileList({ files, nameConflictObject, handleDeleteButtonClick, handleRename, changeDuplicateOption }) {

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
              ${file.file.name in nameConflictObject ? 'file-list-item-duplicate' : ''}`}
        >
          <div
            className={`file-list-item-info
            ${file.result ? 'message' : ''}`}
          >
            <div className="file-list-item-icon">
              {getFileExtensionEmoji(file.file.name)}
            </div>
            <div 
              className={`file-list-item-name-container ${activeFile === file.id ? 'name-focused' : ''}`}
            >
              <input
                ref={activeFile === file.id ? inputRef : null}
                type="text"
                name={`${file.file.name}-${file.id}`}
                title={activeFile === file.id ? activeValue : `Click to rename the file ${file.file.name}`}
                className="file-list-item-name"
                value={activeFile === file.id ? activeValue : file.file.name}
                onChange={handleChange}
                onFocus={() => {
                  setActiveValue(file.file.name);
                  setActiveFile(file.id);
                }}
                onKeyDown={(e) => {if (e.key === 'Enter') {
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
              <div className="duplicate-handling-options-toggle">
                <button 
                  className={`mode-btn ${file.duplicateHandlingOption === 'skip' ? 'active' : ''}`}
                  onClick={() => changeDuplicateOption(file.id, 'skip')}
                  title={[file.duplicateHandlingOption === 'skip' ? 
                    'Currently toggled' : 'Toggle', `to skip uploading this file ${file.file.name}`,
                    'if it already exists in the upload directory'].join(' ')}
                >
                  Skip
                </button>
                <button 
                  className={`mode-btn ${file.duplicateHandlingOption === 'replace' ? 'active' : ''}`}
                  onClick={() => changeDuplicateOption(file.id, 'replace')}
                  title={[file.duplicateHandlingOption === 'replace' ? 
                    'Currently toggled' : 'Toggle', 'to replace a possibly existing file in the',
                    `upload directory with this file ${file.file.name}`].join(' ')}
                >
                  Replace
                </button>
                <button 
                  className={`mode-btn ${file.duplicateHandlingOption === 'keep' ? 'active' : ''}`}
                  onClick={() => changeDuplicateOption(file.id, 'keep')}
                  title={[file.duplicateHandlingOption === 'keep' ? 
                    'Currently toggled' : 'Toggle', `to rename this file ${file.file.name} with a number`,
                    'and keep any existing file in the upload directory'].join(' ')}
                >
                  Keep
                </button>
              </div>
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