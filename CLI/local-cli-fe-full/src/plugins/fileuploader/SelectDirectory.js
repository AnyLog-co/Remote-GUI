import React, { useState, useRef } from 'react';
import '../../styles/FileuploaderPage.css';
import AsyncCreatableSelect from 'react-select/async-creatable';
import { components } from 'react-select';

// solution: https://github.com/JedWatson/react-select/discussions/4302
const Input = (props) => <components.Input {...props} isHidden={false} />;

function SelectDirectory({ defaultDirectory, setDirectoryCallback }) {

  const [value, setValue] = useState();
  const [inputValue, setInputValue] = useState("");
  const selectRef = useRef();

  const defaultDirectorySetting = {
    label: defaultDirectory, 
    value: defaultDirectory
  }

  // load current directory for navigation
  const loadDirectory = () => {

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
      setInputValue(option ? option.label : "");
      setDirectoryCallback(option);
    } else {

      // do default directory if empty
      setValue(defaultDirectorySetting);
      setDirectoryCallback(defaultDirectorySetting);
    }
  };

  const onFocus = () => value && selectRef.current.inputRef.select();

  return (
    <AsyncCreatableSelect
      ref={selectRef}
      value={value}
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