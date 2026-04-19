import React, { useState, useRef } from 'react';
import '../../styles/FileuploaderPage.css';
import AsyncCreatableSelect from 'react-select/async-creatable';
import { components } from 'react-select';

const API_URL = window._env_?.REACT_APP_API_URL || "http://localhost:8000";

// solution: https://github.com/JedWatson/react-select/discussions/4302
const Input = (props) => <components.Input {...props} isHidden={false} />;

function SelectDirectory({ node, defaultDirectory, setDirectoryCallback }) {

  const [value, setValue] = useState();
  const [inputValue, setInputValue] = useState("");
  const selectRef = useRef();

  // keeps track of current options to rearrange if needed
  const options = useRef([]);
  const prevDirectoryCount = useRef(0);

  const defaultDirectorySetting = {
    label: defaultDirectory, 
    value: defaultDirectory
  }

  // load current directory for navigation (only rearrange current list if a / wasn't put in)
  const loadDirectories = async (input) => {

    const directory = input.trim();

    // rearrange elements if there is no need to re-fetch
    // condition is based on checking if user is leaving or entering directory (discrepancy in number of /'s)
    const directoryCount = (directory.match(/\//g) || []).length;

    // rearrangement: put matching directories to the front of the list and avoid making api call
    if (directoryCount === prevDirectoryCount.current) {
      // create a deep copy of the array
      const list = [];
      options.current.forEach((option) => list.push({label: option.label, value: option.value}));

      const matches = [];
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].label.toLowerCase().includes(directory.toLowerCase())) {
          matches.push(list.splice(i, 1)[0]);
        }
      }
      
      const newFront = matches.reverse();
      options.current = newFront.concat(list);
      prevDirectoryCount.current = directoryCount;
      return options.current;
    }
    
    // if failure happens, fetch by default on the next load
    prevDirectoryCount.current = -1;

    try {
      const response = await fetch(`${API_URL}/fileuploader/get-directories`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          conn: node,
          directory_path: directory,
        }),
      });

      if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.detail || `HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      const list = []; 
      
      data.forEach((dir) => list.push({label: dir, value: dir}));
      options.current = list;
      prevDirectoryCount.current = directoryCount;
      return options.current;
    } catch (err) {
      return [];
    }
  }

  const onInputChange = (inputValue, { action }) => {
    // onBlur => setInputValue to last selected value
    // if click away without creating using menu, then delete input label
    // if (action === "input-blur") {
    //   setInputValue(value ? value.label : "");
    // }

    // onInputChange => update inputValue
    if (action === "input-change") {
      setValue(inputValue);
      setInputValue(inputValue);
      // if (inputValue.trim().length == 0 && value) {
      //   selectRef.current.commonProps.clearValue();
      // }
    }
  };

  const onChange = (option) => {
    if (option) {
      setValue(option);
      setInputValue(option.label);
      setDirectoryCallback(option.label.trim());
    } else {

      // do default directory if empty
      setValue(defaultDirectorySetting);
      setDirectoryCallback(defaultDirectory.trim());
    }
  };

  const onFocus = () => value && selectRef.current.inputRef.select();

  return (
    <AsyncCreatableSelect
      ref={selectRef}
      value={value}
      createOptionPosition='first'
      loadOptions={loadDirectories}
      defaultOptions={[defaultDirectorySetting]}
      placeholder={`Default: ${defaultDirectory}`}
      inputValue={inputValue}
      onInputChange={onInputChange}
      onChange={onChange}
      onFocus={onFocus}
      controlShouldRenderValue={false}
      components={{
        Input
      }}
    />
  );
};

export default SelectDirectory;