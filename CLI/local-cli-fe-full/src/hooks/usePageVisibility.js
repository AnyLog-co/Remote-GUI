import { useEffect, useState } from 'react';

const getPageVisible = () => {
  if (typeof document === 'undefined') return true;
  return !document.hidden;
};

export default function usePageVisibility() {
  const [visible, setVisible] = useState(getPageVisible);

  useEffect(() => {
    const updateVisibility = () => setVisible(getPageVisible());

    document.addEventListener('visibilitychange', updateVisibility);
    window.addEventListener('focus', updateVisibility);
    window.addEventListener('blur', updateVisibility);

    return () => {
      document.removeEventListener('visibilitychange', updateVisibility);
      window.removeEventListener('focus', updateVisibility);
      window.removeEventListener('blur', updateVisibility);
    };
  }, []);

  return visible;
}
