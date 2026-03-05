import React, { useCallback, useMemo } from 'react';
import { v4 as uuidv4 } from 'uuid';
import '../../styles/FileuploaderPage.css';
import {useDropzone} from 'react-dropzone';

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

function FileDropzone({ setFilesCallback }) {

  // put in list of files with a unique id
  const onDrop = useCallback(acceptedFiles => {
    const filesToBeAdded = [];
    acceptedFiles.map((file) => {
      filesToBeAdded.push({
        id: uuidv4(),
        file: file,
        result: null,
      });
    })
    setFilesCallback(filesToBeAdded);
  }, []);

  const {
    getRootProps,
    getInputProps,
    isFocused,
    isDragActive
  } = useDropzone({onDrop})

  // style changes when dragging files over or focusing the zone
  const style = useMemo(() => ({
    ...(isFocused ? focusedStyle : {}),
    ...(isDragActive ? activeStyle : {}),
  }), [isDragActive, isFocused]);

  return (
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
  );
};

export default FileDropzone;