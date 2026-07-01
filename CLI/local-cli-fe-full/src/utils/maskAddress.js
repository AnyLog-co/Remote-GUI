const IPV4_ADDRESS_PATTERN = /\b(\d{1,3})\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?\b/g;
const HAS_IPV4_ADDRESS_PATTERN = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?\b/;

export const maskNodeAddress = (value) => {
  const text = String(value || '');
  return text.replace(IPV4_ADDRESS_PATTERN, (_, firstOctet, port = '') => (
    `${firstOctet}.***.***.***${port}`
  ));
};

export const hasMaskableAddress = (value) => (
  HAS_IPV4_ADDRESS_PATTERN.test(String(value || ''))
);
