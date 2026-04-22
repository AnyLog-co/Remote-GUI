import { useEffect } from 'react';
import '../../styles/CLIPage.css';
import TerminalView from './subcomponents/TerminalView';
import StatusBar from './subcomponents/StatusBar';
import { cliState } from './state/state';

const ConnectionView = ({ conn }) => {
  const entries = Object.entries(conn);
  const focusedTerminalId = cliState((s) => s.focusedTerminalId);
  const setFocusedTerminalId = cliState((s) => s.setFocusedTerminalId);

  useEffect(() => {
    if (!focusedTerminalId) return;
    const el = document.getElementById(`terminal-card-${focusedTerminalId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    setFocusedTerminalId(null);
  }, [focusedTerminalId, setFocusedTerminalId]);

  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        padding: '16px',
        boxSizing: 'border-box',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        {entries.map(([id, c]) => (
          <div
            key={id}
            id={`terminal-card-${id}`}
            style={{
              flex: entries.length === 1 ? '1 1 auto' : '0 0 auto',
              ...(entries.length > 1 && {
                height: 'calc(100vh - 200px)',
                minHeight: 'calc(100vh - 200px)',
              }),
              display: 'flex',
              flexDirection: 'column',
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
              backgroundColor: c.starred ? '#fffbeb' : 'white',
              transition: 'background-color 0.2s',
              overflow: 'hidden',
            }}
          >
            <StatusBar id={id} conn={c} />
            <div
              style={{
                flex: 1,
                minHeight: 0,
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <TerminalView
                id={id}
                host={c.ip}
                user={c.user}
                credential={c.credential}
                action={c.action ?? 'direct_ssh'}
                authType={c.authType}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ConnectionView;
