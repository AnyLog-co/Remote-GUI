import React, { useEffect, useState } from 'react';
import { FaEye, FaEyeSlash } from 'react-icons/fa';
import '../styles/MaskedNodeAddress.css';

const MaskedTextInput = ({
  value,
  onChange,
  className = '',
  wrapperClassName = '',
  buttonClassName = '',
  label = 'value',
  resetKey,
  ...inputProps
}) => {
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    setRevealed(false);
  }, [resetKey]);

  return (
    <span className={`masked-text-input ${wrapperClassName}`.trim()}>
      <input
        {...inputProps}
        type={revealed ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        className={className}
      />
      <button
        type="button"
        className={`masked-node-address-toggle masked-text-input-toggle ${buttonClassName}`.trim()}
        onClick={() => setRevealed(prev => !prev)}
        aria-label={`${revealed ? 'Hide' : 'Show'} ${label}`}
        title={`${revealed ? 'Hide' : 'Show'} ${label}`}
        aria-pressed={revealed}
      >
        {revealed ? <FaEyeSlash aria-hidden="true" /> : <FaEye aria-hidden="true" />}
      </button>
    </span>
  );
};

export default MaskedTextInput;
