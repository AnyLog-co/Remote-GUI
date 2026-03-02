import { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import { cliState } from '../state/state';
import '../styles/TerminalView.css';

const TerminalView = ({ id, host, user, credential, action, authType }) => {
  const terminalRef = useRef(null);
  const termRef = useRef(null);
  const wsRef = useRef(null);
  const fitRef = useRef(null);
  const { setIsConnected, removeActiveConnection } = cliState();
  const API_URL = window.env?.REACT_APP_API_URL || 'http://localhost:8000/';
  var strippedURL = (strippedURL = API_URL.replace('http://', ''));

  const isConnected = cliState(
    (state) => state.activeConnection[id]?.isConnected ?? false,
  );

  useEffect(() => {
    const wsStatusCheck = setInterval(() => {
      const isOpen = wsRef.current?.readyState === WebSocket.OPEN;
      setIsConnected(id, isOpen);
    }, 1000);

    return () => clearInterval(wsStatusCheck);
  }, [id, setIsConnected]);

  useEffect(() => {
    console.log('isConnected:', isConnected);
    if (!isConnected) {
      const timer = setTimeout(() => {
        console.log('Not connected. return to main.');
        alert(`Could not connect to ${id}.`);
        removeActiveConnection(id);
      }, 1500);

      return () => clearTimeout(timer);
    }
  }, [isConnected]);

  useEffect(() => {
    if ((!host || !user || !credential || !action, !authType)) return;
    if (termRef.current) return;

    const run = async () => {
      console.log(
        `Connecting to host ${host} through ${action} with ${authType}`,
      );
      console.log('NEW URL!!!!!! ', strippedURL);

      const term = new Terminal({
        cursorBlink: true,
        fontSize: 14,
        fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      });
      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      fitRef.current = fitAddon;

      termRef.current = term;

      term.open(terminalRef.current);

      const fitTerminal = () => {
        if (!terminalRef.current || !fitRef.current) return;

        const rect = terminalRef.current.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          try {
            fitRef.current.fit();
          } catch (e) {}
        }
      };

      setTimeout(fitTerminal, 100);

      const resizeObserver = new ResizeObserver(() => {
        fitTerminal();
      });

      if (terminalRef.current) {
        resizeObserver.observe(terminalRef.current);
      }

      const writeErr = (msg) => {
        term.writeln('');
        term.write(msg);
        term.scrollToBottom();
      };

      let conn_method = {};
      if (authType === 'password') {
        conn_method = {
          method: 'password',
          data: credential,
        };
      } else {
        conn_method = {
          method: 'key-string',
          data: credential,
        };
      }

      const ws = new WebSocket(`ws://${strippedURL}cli/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            action: action,
            host: host,
            user: user,
            conn_method: conn_method,
            cols: term.cols,
            rows: term.rows,
          }),
        );
      };

      ws.onmessage = (e) => {
        term.write(e.data);
        term.scrollToBottom();
      };

      ws.onerror = (e) => {
        console.log(e);
        writeErr(`WebSocket error: Disconnected`);
      };

      ws.onclose = (e) => {
        if (!e.wasClean) {
          console.log(`Unexpected websocket interruption: `, e);
        } else {
          console.log(`Disconnected. Session ended`);
        }
      };

      term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ action: 'client_input', input: data }));
        }
      });

      term.onResize(({ cols, rows }) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              action: 'resize',
              cols: cols,
              rows: rows,
            }),
          );
        }
      });

      const handleWindowResize = () => {
        fitTerminal();
      };

      window.addEventListener('resize', handleWindowResize);

      return () => {
        resizeObserver.disconnect();
        window.removeEventListener('resize', handleWindowResize);
        term.dispose();
        ws.close();
        termRef.current = null;
        wsRef.current = null;
      };
    };

    run();
  }, [host, user, credential, action, authType]);

  return (
    <div
      id="terminal-overall-div"
      ref={terminalRef}
      className="terminal-overall-div"
    />
  );
};

export default TerminalView;
