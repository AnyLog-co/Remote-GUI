import { useEffect, useRef, useState } from 'react';
import {
  attachTerminalSession,
  getOrCreateTerminalSession,
} from '../sessionManager';
import '../styles/TerminalView.css';
import { getApiBaseUrl } from '../../../utils/runtimeConfig';

const TerminalView = ({
  id,
  name,
  ip,
  user,
  credential,
  action,
  authType,
  port,
}) => {
  const terminalRef = useRef(null);
  const [isReady, setIsReady] = useState(false);
  const API_URL = getApiBaseUrl();

  useEffect(() => {
    if (!id || !name || !ip || !user || !action || !authType || !port) return;

    const session = getOrCreateTerminalSession({
      id,
      name,
      ip,
      user,
      credential,
      action,
      authType,
      port,
      apiUrl: API_URL,
      onReady: () => setIsReady(true),
    });

    setIsReady(session.isReady);

    const detach = attachTerminalSession(id, terminalRef.current);
    return () => {
      detach();
      session.onReady = null;
    };
  }, [API_URL, id, name, ip, user, credential, action, authType, port]);

  return (
    <div
      id="terminal-overall-div"
      ref={terminalRef}
      className="terminal-overall-div"
      style={{ visibility: isReady ? 'visible' : 'hidden' }}
    />
  );
};

export default TerminalView;
