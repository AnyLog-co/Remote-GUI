import React from 'react';
import { FaEye, FaEyeSlash } from 'react-icons/fa';
import { hasMaskableAddress, maskNodeAddress } from '../utils/maskAddress';
import '../styles/MaskedNodeAddress.css';

const MaskedNodeAddress = ({
  value,
  revealed,
  onToggle,
  className = '',
  buttonClassName = '',
  label = 'node address',
  showText = true,
}) => {
  const canMask = hasMaskableAddress(value);
  const displayValue = revealed || !canMask ? String(value || '') : maskNodeAddress(value);

  return (
    <span className={`masked-node-address ${className}`.trim()}>
      {showText && <span className="masked-node-address-text">{displayValue}</span>}
      {canMask && (
        <button
          type="button"
          className={`masked-node-address-toggle ${buttonClassName}`.trim()}
          onClick={(event) => {
            event.stopPropagation();
            onToggle?.();
          }}
          aria-label={`${revealed ? 'Hide' : 'Show'} ${label}`}
          title={`${revealed ? 'Hide' : 'Show'} ${label}`}
          aria-pressed={revealed}
        >
          {revealed ? <FaEyeSlash aria-hidden="true" /> : <FaEye aria-hidden="true" />}
        </button>
      )}
    </span>
  );
};

export default MaskedNodeAddress;
