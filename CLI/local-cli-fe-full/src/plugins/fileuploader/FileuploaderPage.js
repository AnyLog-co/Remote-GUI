import React, {useCallback, useMemo} from 'react';
import {useDropzone} from 'react-dropzone';
import '../../styles/FileuploaderPage.css';

// from https://react-dropzone.js.org/#!/Examples
const baseStyle = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '24px',
  borderWidth: 2,
  borderRadius: '6px',
  borderColor: '#eeeeee',
  borderStyle: 'dashed',
  backgroundColor: '#f8fafc',
  color: '#cbd5e1',
  outline: 'none',
  transition: 'background-color .12s ease-in-out, border .24s ease-in-out'
};

const focusedStyle = {
  borderColor: '#2196f3',
  transition: 'border .24s ease-in-out'
};

const activeStyle = {
  borderColor: '#00e676',
  backgroundColor: '#e9eaef',
  color: '#c3ccd7',
  transition: 'background-color .12s ease-in-out, border .24s ease-in-out'
};

function FileuploaderPage({ node }) {
  const onDrop = useCallback(acceptedFiles => {
    // Do something with the files
  }, [])
  const {
    getRootProps,
    getInputProps,
    isFocused,
    isDragActive
  } = useDropzone({onDrop})

  const style = useMemo(() => ({
    ...baseStyle,
    ...(isFocused ? focusedStyle : {}),
    ...(isDragActive ? activeStyle : {}),
  }), [
    isFocused,
    isDragActive
  ]);

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

      <div {...getRootProps({style})}>
        <input {...getInputProps()} />
          <p className={isDragActive ? "drag-active" : "drag-inactive"}>Drop the file(s) here ...</p> :
          <p className={isDragActive ? "drag-inactive" : "drag-active"}>Drag-and-drop files here, or click to select files</p>
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
