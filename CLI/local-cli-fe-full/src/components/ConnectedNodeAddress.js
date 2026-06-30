import React, { useEffect, useState } from 'react';
import MaskedNodeAddress from './MaskedNodeAddress';

const ConnectedNodeAddress = ({
  value,
  label = 'Connected Node:',
  as: Wrapper = 'p',
  className = '',
  labelClassName = '',
  valueClassName = '',
}) => {
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    setRevealed(false);
  }, [value]);

  if (!value) {
    return null;
  }

  return (
    <Wrapper className={`connected-node-address ${className}`.trim()}>
      <strong className={`connected-node-address-label ${labelClassName}`.trim()}>{label}</strong>
      <MaskedNodeAddress
        value={value}
        revealed={revealed}
        onToggle={() => setRevealed(prev => !prev)}
        label="node address"
        className={`connected-node-address-value ${valueClassName}`.trim()}
      />
    </Wrapper>
  );
};

export default ConnectedNodeAddress;
