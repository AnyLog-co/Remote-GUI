import React from 'react';
import '../../styles/FileuploaderPage.css';

function FileList({ files, handleDeleteButtonClick }) {
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

  return (
    <React.Fragment>
      {files.map((file) => (
        <div key={file.id}className="file-list-item">
          <div className="uns-item-icon">
            {getFileExtensionEmoji(file.file.name)}
          </div>
          <div className="file-list-item-name">
            {file.file.name}
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
      ))}
    </React.Fragment>
  );
};

export default FileList;