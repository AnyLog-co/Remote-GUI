import React, { useState, useRef } from 'react';
import '../../styles/FileuploaderPage.css';

function FileList({ files, nameConflictObject, handleDeleteButtonClick, handleRename, changeSelection }) {

  // only one state needed to handle renaming of one file
  const inputRef = useRef();
  const [activeName, setActiveName] = useState(null);
  const [activeNameValue, setActiveNameValue] = useState("");

  const getFileExtensionEmoji = (fileName) => {
    const fileExtension = fileName.split('.').pop().toLowerCase();
    
    // https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Image_types
    const imageExtension = ['apng', 'png', 'avif', 'gif', 'jpg', 'jpeg', 'jfif',
      'pjpeg', 'pjp', 'svg', 'webp', 'bmp', 'ico', 'cur', 'tif', 'tiff',
    ];

    // https://www.geeksforgeeks.org/techtips/text-file-formats/
    const textExtension = ['asc', 'doc', 'docx', 'rtf', 'msg', 'pdf', 'txt', 'wpd', 'wps'];

    // https://en.wikipedia.org/wiki/Audio_file_format
    const soundExtension = [
      '3gp', 'aa', 'aac', 'aax', 'act', 'aiff', 'alac', 'amr', 'ape', 'au',
      'awb', 'cda', 'dss', 'dvf', 'flac', 'gsm', 'iklax', 'ivs', 'm4a', 'm4b',
      'm4p', 'mmf', 'mogg', 'movpkg', 'mp1', 'mp2', 'mp3', 'mpc', 'msv', 'nmf',
      'oga', 'ogg', 'opus', 'ra', 'raw', 'rf64', 'rm', 'sln', 'tta', 'voc',
      'vox', 'wav', 'webm', 'wma', 'wv', '8svx',
    ];

    // https://en.wikipedia.org/wiki/Video_file_format
    const videoExtension = [
      '3g2', '3gp', 'amv', 'asf', 'avi', 'drc', 'f4a', 'f4b', 'f4p', 'f4v',
      'flv', 'gifv', 'm2ts', 'm2v', 'm4p', 'm4v', 'mkv', 'mng', 'mov', 'mp2',
      'mp4', 'mpe', 'mpeg', 'mpg', 'mpv', 'mts', 'mxf', 'nsv', 'ogg', 'ogv',
      'qt', 'rm', 'rmvb', 'roq', 'svi', 'ts', 'viv', 'vob', 'webm', 'wmv',
      'yuv',
    ];

    if (imageExtension.includes(fileExtension)) return '🖼️';
    else if (textExtension.includes(fileExtension)) return '📄';
    else if (soundExtension.includes(fileExtension)) return '🔊';
    else if (videoExtension.includes(fileExtension)) return '🎬';
    else {
      return '📁';
    }
  }

  const formatSize = (bytes) => {
    const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    let i = 0;
    while (bytes >= 1024 && i < units.length - 1) {
      bytes /= 1024;
      i++;
    }
    const digits = bytes < 10 ? 2 : bytes < 100 ? 2 : bytes < 1000 ? 1 : 0;
    return `${bytes.toFixed(digits)} ${units[i]}`;
  };

  const handleNameChange = (event) => {
    setActiveNameValue(event.target.value);
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
            <input
              type="checkbox"
              title={file.selected ? `Click to deselect the file ${file.file.name}` : `Click to select the file ${file.file.name}`}
              className="file-list-item-icon checkbox"
              checked={file.selected}
              onChange={() => changeSelection(file.id, !file.selected)}
            />
            <div className="file-list-item-icon">
              {getFileExtensionEmoji(file.file.name)}
            </div>
            <div 
              className={`file-list-item-name-container ${activeName === file.id ? 'name-focused' : ''}`}
            >
              <input
                ref={activeName === file.id ? inputRef : null}
                type="text"
                name={`${file.file.name}-${file.id}`}
                title={activeName === file.id ? activeNameValue : `Click to rename the file ${file.file.name}`}
                className="file-list-item-name"
                value={activeName === file.id ? activeNameValue : file.file.name}
                onChange={handleNameChange}
                onFocus={() => {
                  setActiveNameValue(file.file.name);
                  setActiveName(file.id);
                }}
                onKeyDown={(e) => {if (e.key === 'Enter') {
                  inputRef.current.blur();
                  handleRename(file.id, file.file.name, activeNameValue);
                  setActiveName(null);
                }}}
                onBlur={() => {
                  handleRename(file.id, file.file.name, activeNameValue);
                  setActiveName(null);
                }}  
              />
            </div>
            <div className="file-list-item-actions">
              <div
                className={file.file.size > 10 * 1024 * 1024 ? 'error-text-color' : ''}
                title={file.file.size > 10 * 1024 * 1024 ? 'Warning: this file is greater than 10 MB' : ''}
              >
                {formatSize(file.file.size)}
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
          (file.result.skipped && file.result.warning?.length > 0 ?
          <div className="file-list-item-warning">
            Warning: {file.result.warning}
          </div>
          :
          (file.result.errors ? 
          <div className="file-list-item-error">
            Error(s): {file.result.errors.map((error) => `${error}\n`)}
          </div>
          :
          (file.result.skipped)
          )))}
        </div>
      ))}
    </React.Fragment>
  );
};

export default FileList;