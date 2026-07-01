import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { cliState } from './state/state';
import 'xterm/css/xterm.css';

const sessions = new Map();

const buildConnMethod = ({ authType, credential }) => {
  if (authType === 'password') {
    return {
      method: 'password',
      data: credential,
    };
  }

  return {
    method: 'key-string',
    data: credential,
  };
};

const writeError = (term, msg) => {
  term.writeln('');
  term.write(msg);
  term.scrollToBottom();
};

const setConnected = (id, isConnected) => {
  cliState.getState().setIsConnected(id, isConnected);
};

const removeDisconnectedSession = (id, reason) => {
  const state = cliState.getState();
  state.setIsConnected(id, false);
  state.setTerminalLoading(false);
  state.setTerminalError(reason || null);
  state.removeActiveConnection(id);
};

const fitSession = (session) => {
  if (!session.container || !session.fitAddon) return;

  const rect = session.container.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) {
    try {
      session.fitAddon.fit();
    } catch (e) {}
  }
};

const sendStartMessage = (session) => {
  const {
    ws,
    term,
    id,
    name,
    ip,
    user,
    credential,
    action,
    authType,
    port,
  } = session;

  if (!credential) {
    ws.send(
      JSON.stringify({
        action: 'reattach',
        session_id: id,
        cols: term.cols,
        rows: term.rows,
      }),
    );
    return;
  }

  ws.send(
    JSON.stringify({
      action,
      session_id: id,
      name,
      ip,
      user,
      port,
      conn_method: buildConnMethod({ authType, credential }),
      cols: term.cols,
      rows: term.rows,
    }),
  );
};

const connectSession = (session) => {
  if (
    session.ws &&
    [WebSocket.CONNECTING, WebSocket.OPEN].includes(session.ws.readyState)
  ) {
    return;
  }

  session.manualClose = false;
  session.hasReceivedFirstMessage = false;

  const wsUrl = new URL('/sshclient/ws', session.apiUrl);
  wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:';

  const ws = new WebSocket(wsUrl.toString());
  session.ws = ws;

  ws.onopen = () => {
    cliState.getState().setTerminalLoading(true);
    setConnected(session.id, true);
    sendStartMessage(session);
  };

  ws.onmessage = (event) => {
    if (!session.hasReceivedFirstMessage) {
      session.hasReceivedFirstMessage = true;
      session.isReady = true;
      cliState.getState().setTerminalLoading(false);
      cliState.getState().setShowAuthModal(false);
      session.onReady?.();
    }

    session.term.write(event.data);
    session.term.scrollToBottom();
  };

  ws.onerror = (event) => {
    cliState.getState().setTerminalLoading(false);
    console.log(event);
    writeError(session.term, 'WebSocket error: Disconnected');
  };

  ws.onclose = (event) => {
    setConnected(session.id, false);

    if (session.manualClose) return;

    const reason = event.reason || 'SSH session disconnected';
    writeError(session.term, `\r\n${reason}`);
    sessions.delete(session.id);
    removeDisconnectedSession(session.id, reason);
  };

  session.dataDisposable = session.term.onData((data) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          action: 'client_input',
          session_id: session.id,
          input: data,
        }),
      );
    }
  });

  session.resizeDisposable = session.term.onResize(({ cols, rows }) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          action: 'resize',
          session_id: session.id,
          cols,
          rows,
        }),
      );
    }
  });
};

export const getOrCreateTerminalSession = (options) => {
  const existing = sessions.get(options.id);
  if (existing) {
    existing.onReady = options.onReady;
    return existing;
  }

  const term = new Terminal({
    cursorBlink: true,
    fontSize: 14,
    fontFamily: 'Menlo, Monaco, "Courier New", monospace',
  });
  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);

  const session = {
    ...options,
    term,
    fitAddon,
    ws: null,
    container: null,
    resizeObserver: null,
    isReady: false,
    manualClose: false,
    hasReceivedFirstMessage: false,
    dataDisposable: null,
    resizeDisposable: null,
  };

  sessions.set(options.id, session);
  return session;
};

export const attachTerminalSession = (id, container) => {
  const session = sessions.get(id);
  if (!session || !container) return () => {};

  session.container = container;

  if (session.term.element) {
    container.appendChild(session.term.element);
  } else {
    session.term.open(container);
  }

  setTimeout(() => fitSession(session), 100);

  session.resizeObserver = new ResizeObserver(() => {
    fitSession(session);
  });
  session.resizeObserver.observe(container);

  const handleWindowResize = () => fitSession(session);
  window.addEventListener('resize', handleWindowResize);

  connectSession(session);

  return () => {
    session.resizeObserver?.disconnect();
    session.resizeObserver = null;
    window.removeEventListener('resize', handleWindowResize);
    session.container = null;
  };
};

export const closeTerminalSession = (id) => {
  const session = sessions.get(id);
  if (!session) {
    cliState.getState().removeActiveConnection(id);
    return;
  }

  session.manualClose = true;

  if (session.ws?.readyState === WebSocket.OPEN) {
    session.ws.send(
      JSON.stringify({
        action: 'close_session',
        session_id: id,
      }),
    );
  }

  session.ws?.close();
  session.dataDisposable?.dispose();
  session.resizeDisposable?.dispose();
  session.resizeObserver?.disconnect();
  session.term.dispose();
  sessions.delete(id);
  cliState.getState().setIsConnected(id, false);
  cliState.getState().removeActiveConnection(id);
};
