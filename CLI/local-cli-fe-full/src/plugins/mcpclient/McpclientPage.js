import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  FaCheckCircle,
  FaCode,
  FaCog,
  FaDownload,
  FaExclamationTriangle,
  FaFilePdf,
  FaInfoCircle,
  FaPaperPlane,
  FaPlug,
  FaPlus,
  FaPowerOff,
  FaServer,
  FaStop,
  FaSyncAlt,
  FaTrash,
} from 'react-icons/fa';
import {
  askMCP,
  askMCPStream,
  cancelMCPStream,
  connectMCP,
  disconnectMCP,
  getMCPStatus,
  listMCPTools,
  listModels,
} from './mcpclient_api';
import MarkdownRenderer from './MarkdownRenderer';
import usePageVisibility from '../../hooks/usePageVisibility';

export const pluginMetadata = {
  name: 'MCP Client',
  icon: null
};

const DEFAULT_MCP_PATH = '/mcp/sse';
const PREFERRED_MODEL = '';
const MODEL_PLACEHOLDER = 'Select a running model';
const DEFAULT_LLM_API_TYPE = 'auto';
const DEFAULT_REQUEST_TIMEOUT_SECONDS = 900;
const MIN_REQUEST_TIMEOUT_SECONDS = 30;
const MAX_REQUEST_TIMEOUT_SECONDS = 7200;
const HISTORY_STORAGE_KEY = 'mcpclient_chat_history';
const CONFIG_STORAGE_KEY = 'mcpclient_config';
const CHAT_SESSIONS_STORAGE_KEY = 'mcpclient_chats_v2';
const ACTIVE_CHAT_STORAGE_KEY = 'mcpclient_active_chat_id';
const DEFAULT_ASSISTANT_NAME = 'Assistant';

const getModelName = (model, index = 0) => (
  model?.name || model?.model || model?.model_name || model?.digest || `model-${index + 1}`
);

const normalizeEndpoint = (value) => {
  const trimmed = (value || '').trim();
  return trimmed || null;
};

const getNodeValue = (node) => {
  if (!node) return '';
  if (typeof node === 'string') return node.trim();
  if (typeof node === 'object') return (node.node || node.value || node.address || '').trim();
  return '';
};

const mcpUrlFromNode = (node) => {
  const nodeValue = getNodeValue(node);
  if (!nodeValue) return '';
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(nodeValue)) {
    try {
      const url = new URL(nodeValue);
      url.pathname = DEFAULT_MCP_PATH;
      url.search = '';
      url.hash = '';
      return url.toString().replace(/\/$/, '');
    } catch (_) {
      return '';
    }
  }
  return `http://${nodeValue}${DEFAULT_MCP_PATH}`;
};

const downloadTextFile = (filename, content, mimeType) => {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

const stripMarkdown = (content) => (content || '')
  .replace(/```[\w+#.-]*\n?([\s\S]*?)```/g, '$1')
  .replace(/`([^`]+)`/g, '$1')
  .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  .replace(/\*\*([^*]+)\*\*/g, '$1')
  .replace(/\*([^*]+)\*/g, '$1')
  .replace(/^#+\s+/gm, '')
  .replace(/^---$/gm, '');

const extractArtifacts = (content) => {
  const blocks = [];
  const regex = /```([a-zA-Z0-9+#.-]*)\s*\n([\s\S]*?)```/g;
  let match;

  while ((match = regex.exec(content || '')) !== null) {
    const language = (match[1] || 'txt').toLowerCase();
    blocks.push({
      language,
      code: match[2].trim(),
    });
  }

  const htmlBlocks = blocks.filter((block) => ['html', 'htm'].includes(block.language));
  const cssBlocks = blocks.filter((block) => block.language === 'css');
  const jsBlocks = blocks.filter((block) => ['js', 'javascript'].includes(block.language));
  const hasPreview = htmlBlocks.length > 0 || (cssBlocks.length > 0 && jsBlocks.length > 0);

  const html = htmlBlocks[0]?.code || '';
  const css = cssBlocks.map((block) => block.code).join('\n\n');
  const js = jsBlocks.map((block) => block.code).join('\n\n');
  const srcDoc = html || `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>${css}</style>
  </head>
  <body>
    <main id="app"></main>
    <script>${js}</script>
  </body>
</html>`;

  return { blocks, hasPreview, srcDoc, html, css, js };
};

const fileMetaForLanguage = (language) => {
  if (['html', 'htm'].includes(language)) return { ext: 'html', mime: 'text/html' };
  if (language === 'css') return { ext: 'css', mime: 'text/css' };
  if (['js', 'javascript'].includes(language)) return { ext: 'js', mime: 'text/javascript' };
  if (language === 'json') return { ext: 'json', mime: 'application/json' };
  return { ext: 'txt', mime: 'text/plain' };
};

const formatDuration = (ms) => {
  if (typeof ms !== 'number' || Number.isNaN(ms)) return '0 ms';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)} s`;
};

const stringifyPayload = (payload) => {
  try {
    return JSON.stringify(payload ?? {}, null, 2);
  } catch (_) {
    return String(payload ?? '');
  }
};

const formatBriefError = (message = '') => {
  const firstLine = String(message || 'Failed to process question.').split('\n').find(Boolean) || 'Failed to process question.';
  return firstLine.length > 220 ? `${firstLine.slice(0, 220)}...` : firstLine;
};

const normalizeRequestTimeout = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_REQUEST_TIMEOUT_SECONDS;
  return Math.max(MIN_REQUEST_TIMEOUT_SECONDS, Math.min(MAX_REQUEST_TIMEOUT_SECONDS, Math.round(parsed)));
};

const createChatId = () => `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const normalizeToolList = (tools = []) => (
  Array.isArray(tools)
    ? tools.map((tool) => (
      typeof tool === 'string'
        ? { name: tool }
        : {
          name: tool?.name || '',
          description: tool?.description || '',
          inputSchema: tool?.inputSchema || tool?.input_schema || {},
        }
    )).filter((tool) => tool.name)
    : []
);

const normalizeMessages = (messages = []) => (
  Array.isArray(messages)
    ? messages.map((message, index) => ({
      ...message,
      id: message.id || `saved-${index}-${message.type || 'message'}`,
      observations: message.type === 'assistant' ? (message.observations || []) : message.observations,
      showObservations: Boolean(message.showObservations),
    }))
    : []
);

const deriveChatTitle = (messages = [], fallback = 'New chat') => {
  const firstUserMessage = messages.find((message) => message.type === 'user' && message.content);
  if (!firstUserMessage) return fallback;
  const compact = firstUserMessage.content.replace(/\s+/g, ' ').trim();
  return compact.length > 44 ? `${compact.slice(0, 44)}...` : compact || fallback;
};

const createChatSession = ({
  title = 'New chat',
  messages = [],
  anylogUrl = '',
  ollamaModel = PREFERRED_MODEL,
  ollamaEndpoint = '',
  llmApiType = DEFAULT_LLM_API_TYPE,
  llmBearerToken = '',
  requestTimeoutSeconds = DEFAULT_REQUEST_TIMEOUT_SECONDS,
  assistantName = DEFAULT_ASSISTANT_NAME,
  instructions = '',
  mcpTools = [],
} = {}) => {
  const now = Date.now();
  return {
    id: createChatId(),
    title,
    createdAt: now,
    updatedAt: now,
    messages: normalizeMessages(messages),
    config: {
      anylogUrl,
      ollamaModel,
      ollamaEndpoint,
      llmApiType,
      llmBearerToken,
      requestTimeoutSeconds: normalizeRequestTimeout(requestTimeoutSeconds),
      assistantName,
      instructions,
      mcpTools: normalizeToolList(mcpTools),
    },
  };
};

const normalizeChatSession = (chat, fallbackConfig = {}) => ({
  id: chat.id || createChatId(),
  title: chat.title || deriveChatTitle(chat.messages, 'New chat'),
  createdAt: chat.createdAt || Date.now(),
  updatedAt: chat.updatedAt || chat.createdAt || Date.now(),
  messages: normalizeMessages(chat.messages),
  config: {
    anylogUrl: chat.config?.anylogUrl || fallbackConfig.anylogUrl || '',
    ollamaModel: chat.config?.ollamaModel || fallbackConfig.ollamaModel || PREFERRED_MODEL,
    ollamaEndpoint: chat.config?.ollamaEndpoint || fallbackConfig.ollamaEndpoint || '',
    llmApiType: chat.config?.llmApiType || fallbackConfig.llmApiType || DEFAULT_LLM_API_TYPE,
    llmBearerToken: chat.config?.llmBearerToken || fallbackConfig.llmBearerToken || '',
    requestTimeoutSeconds: normalizeRequestTimeout(chat.config?.requestTimeoutSeconds ?? fallbackConfig.requestTimeoutSeconds),
    assistantName: chat.config?.assistantName || fallbackConfig.assistantName || DEFAULT_ASSISTANT_NAME,
    instructions: chat.config?.instructions || fallbackConfig.instructions || '',
    mcpTools: normalizeToolList(chat.config?.mcpTools || fallbackConfig.mcpTools || []),
  },
});

const ObservationPanel = ({ observations = [], totalElapsedMs }) => (
  <div className="observation-panel">
    <div className="observation-summary">
      <span>MCP observation log</span>
      <strong>Total {formatDuration(totalElapsedMs || 0)}</strong>
    </div>
    {observations.length === 0 ? (
      <div className="observation-empty">Waiting for MCP sub-requests.</div>
    ) : (
      <div className="observation-list">
        {observations.map((item, index) => (
          <div className={`observation-item ${item.status || 'pending'}`} key={item.id || index}>
            <div className="observation-meta">
              <strong>{item.toolName || item.tool_name || 'MCP request'}</strong>
              <span>{item.status || 'pending'}</span>
              {typeof item.elapsedMs === 'number' && <span>{formatDuration(item.elapsedMs)}</span>}
              {typeof item.totalElapsedMs === 'number' && <span>at {formatDuration(item.totalElapsedMs)}</span>}
            </div>
            <details open={item.status === 'pending' || item.status === 'error'}>
              <summary>Request</summary>
              <pre>{stringifyPayload(item.arguments)}</pre>
            </details>
            {item.status === 'complete' && (
              <details>
                <summary>Response</summary>
                <pre>{stringifyPayload(item.response)}</pre>
              </details>
            )}
            {item.status === 'error' && (
              <details open>
                <summary>Error</summary>
                <pre>{item.error}</pre>
              </details>
            )}
            {item.status === 'error' && item.exception && (
              <details>
                <summary>Full exception</summary>
                <pre>{item.exception}</pre>
              </details>
            )}
          </div>
        ))}
      </div>
    )}
  </div>
);

const ErrorDetails = ({ message, exception }) => (
  <div className="message-error-content">
    <div className="error-summary-text">{formatBriefError(message)}</div>
    {exception && (
      <details className="exception-details">
        <summary>Full exception</summary>
        <pre>{exception}</pre>
      </details>
    )}
  </div>
);

const ArtifactPanel = ({ content, messageIndex }) => {
  const artifacts = useMemo(() => extractArtifacts(content), [content]);

  if (artifacts.blocks.length === 0) return null;

  return (
    <div className="artifact-panel">
      <div className="artifact-header">
        <div className="artifact-title">
          <FaCode />
          <span>Generated artifacts</span>
        </div>
        {artifacts.hasPreview && (
          <button
            className="icon-action"
            type="button"
            title="Download preview HTML"
            aria-label="Download preview HTML"
            onClick={() => downloadTextFile(`mcp-artifact-${messageIndex + 1}.html`, artifacts.srcDoc, 'text/html')}
          >
            <FaDownload />
            HTML
          </button>
        )}
      </div>

      {artifacts.hasPreview && (
        <iframe
          title={`MCP generated preview ${messageIndex + 1}`}
          className="artifact-preview"
          sandbox="allow-scripts allow-forms allow-modals"
          srcDoc={artifacts.srcDoc}
        />
      )}

      <div className="artifact-files">
        {artifacts.blocks.map((block, index) => {
          const meta = fileMetaForLanguage(block.language);
          return (
            <button
              key={`${block.language}-${index}`}
              type="button"
              className="artifact-file"
              onClick={() => downloadTextFile(`mcp-output-${messageIndex + 1}-${index + 1}.${meta.ext}`, block.code, meta.mime)}
            >
              <FaDownload />
              <span>{block.language || 'text'}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

const McpclientPage = ({ node }) => {
  const pageVisible = usePageVisibility();
  const nodeMcpUrl = useMemo(() => mcpUrlFromNode(node), [node]);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState(null);
  const [connected, setConnected] = useState(false);
  const [tools, setTools] = useState([]);
  const [prompt, setPrompt] = useState('');
  const [answers, setAnswers] = useState([]);
  const [runningChatIds, setRunningChatIds] = useState([]);
  const [anylogUrl, setAnylogUrl] = useState(nodeMcpUrl);
  const [ollamaModel, setOllamaModel] = useState(PREFERRED_MODEL);
  const [ollamaEndpoint, setOllamaEndpoint] = useState('');
  const [llmApiType, setLlmApiType] = useState(DEFAULT_LLM_API_TYPE);
  const [llmBearerToken, setLlmBearerToken] = useState('');
  const [models, setModels] = useState([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [streamNote, setStreamNote] = useState('');
  const [modelSource, setModelSource] = useState('local');
  const [assistantName, setAssistantName] = useState(DEFAULT_ASSISTANT_NAME);
  const [requestTimeoutSeconds, setRequestTimeoutSeconds] = useState(DEFAULT_REQUEST_TIMEOUT_SECONDS);
  const [instructions, setInstructions] = useState('');
  const [instructionsSaved, setInstructionsSaved] = useState(false);
  const [chatSessions, setChatSessions] = useState([]);
  const [activeChatId, setActiveChatId] = useState('');

  const abortControllersRef = useRef({});
  const streamRequestIdsRef = useRef({});
  const messagesEndRef = useRef(null);
  const observationPanelRefs = useRef({});
  const skipNextBottomScrollRef = useRef(false);
  const answersRef = useRef([]);
  const activeChatIdRef = useRef('');
  const userEditedAnylogUrlRef = useRef(false);
  const previousNodeMcpUrlRef = useRef(nodeMcpUrl);
  const applyingChatRef = useRef(false);

  const refreshConnectionStatus = async () => {
    try {
      const statusData = await getMCPStatus();
      setStatus(statusData);
      setConnected(Boolean(statusData.connected));
      if (statusData.connected) {
        setTools(normalizeToolList(statusData.available_tools || []));
      } else {
        setTools([]);
      }
    } catch (_) {
      setConnected(false);
      setStatus((prev) => ({ ...(prev || {}), connected: false, available_tools: [] }));
    }
  };

  const applyChatSession = (chat) => {
    if (!chat) return;
    applyingChatRef.current = true;
    const config = chat.config || {};
    setAnswers(normalizeMessages(chat.messages));
    answersRef.current = normalizeMessages(chat.messages);
    setAnylogUrl(config.anylogUrl || nodeMcpUrl || '');
    setOllamaModel(config.ollamaModel || PREFERRED_MODEL);
    setOllamaEndpoint(config.ollamaEndpoint || '');
    setLlmApiType(config.llmApiType || DEFAULT_LLM_API_TYPE);
    setLlmBearerToken(config.llmBearerToken || '');
    setRequestTimeoutSeconds(normalizeRequestTimeout(config.requestTimeoutSeconds));
    setAssistantName(config.assistantName || DEFAULT_ASSISTANT_NAME);
    setInstructions(config.instructions || '');
    setInstructionsSaved(false);
    const chatTools = normalizeToolList(config.mcpTools || []);
    setConnected(false);
    setTools(chatTools);
    setStatus((prev) => ({ ...(prev || {}), connected: false, available_tools: chatTools.map((tool) => tool.name) }));
    setTimeout(() => {
      applyingChatRef.current = false;
    }, 0);
  };

  useEffect(() => {
    let initialAnylogUrl = nodeMcpUrl;
    let initialModel = PREFERRED_MODEL;
    let initialEndpoint = '';
    let initialLlmApiType = DEFAULT_LLM_API_TYPE;
    let initialLlmBearerToken = '';
    let initialRequestTimeoutSeconds = DEFAULT_REQUEST_TIMEOUT_SECONDS;
    let initialAssistantName = DEFAULT_ASSISTANT_NAME;
    let initialInstructions = '';
    let initialMessages = [];
    let initialChats = [];

    try {
      const savedConfig = JSON.parse(localStorage.getItem(CONFIG_STORAGE_KEY) || '{}');
      initialAnylogUrl = nodeMcpUrl || savedConfig.anylogUrl || '';
      initialModel = savedConfig.ollamaModel || PREFERRED_MODEL;
      initialEndpoint = savedConfig.ollamaEndpoint || '';
      initialLlmApiType = savedConfig.llmApiType || DEFAULT_LLM_API_TYPE;
      initialLlmBearerToken = savedConfig.llmBearerToken || '';
      initialRequestTimeoutSeconds = normalizeRequestTimeout(savedConfig.requestTimeoutSeconds);
      initialAssistantName = savedConfig.assistantName || DEFAULT_ASSISTANT_NAME;
      initialInstructions = savedConfig.instructions || '';
      const initialTools = normalizeToolList(savedConfig.mcpTools || []);

      const savedHistory = JSON.parse(localStorage.getItem(HISTORY_STORAGE_KEY) || '[]');
      if (Array.isArray(savedHistory)) {
        initialMessages = normalizeMessages(savedHistory);
      }

      const savedChats = JSON.parse(localStorage.getItem(CHAT_SESSIONS_STORAGE_KEY) || '[]');
      if (Array.isArray(savedChats) && savedChats.length > 0) {
        initialChats = savedChats.map((chat) => normalizeChatSession(chat, {
          anylogUrl: initialAnylogUrl,
          ollamaModel: initialModel,
          ollamaEndpoint: initialEndpoint,
          llmApiType: initialLlmApiType,
          llmBearerToken: initialLlmBearerToken,
          requestTimeoutSeconds: initialRequestTimeoutSeconds,
          assistantName: initialAssistantName,
          instructions: initialInstructions,
          mcpTools: initialTools,
        }));
      }

      if (initialChats.length === 0) {
        initialChats = [createChatSession({
          title: deriveChatTitle(initialMessages, 'New chat'),
          messages: initialMessages,
          anylogUrl: initialAnylogUrl,
          ollamaModel: initialModel,
          ollamaEndpoint: initialEndpoint,
          llmApiType: initialLlmApiType,
          llmBearerToken: initialLlmBearerToken,
          requestTimeoutSeconds: initialRequestTimeoutSeconds,
          assistantName: initialAssistantName,
          instructions: initialInstructions,
          mcpTools: initialTools,
        })];
      }

      const savedActiveId = localStorage.getItem(ACTIVE_CHAT_STORAGE_KEY);
      const activeChat = initialChats.find((chat) => chat.id === savedActiveId) || initialChats[0];

      setChatSessions(initialChats);
      setActiveChatId(activeChat.id);
      activeChatIdRef.current = activeChat.id;
      setAnswers(activeChat.messages);
      answersRef.current = activeChat.messages;
      setAnylogUrl(activeChat.config.anylogUrl || nodeMcpUrl || '');
      setOllamaModel(activeChat.config.ollamaModel || PREFERRED_MODEL);
      setOllamaEndpoint(activeChat.config.ollamaEndpoint || '');
      setLlmApiType(activeChat.config.llmApiType || DEFAULT_LLM_API_TYPE);
      setLlmBearerToken(activeChat.config.llmBearerToken || '');
      setRequestTimeoutSeconds(normalizeRequestTimeout(activeChat.config.requestTimeoutSeconds));
      setAssistantName(activeChat.config.assistantName || DEFAULT_ASSISTANT_NAME);
      setInstructions(activeChat.config.instructions || '');
      setTools(normalizeToolList(activeChat.config.mcpTools || []));

      initialAnylogUrl = activeChat.config.anylogUrl || nodeMcpUrl || '';
      initialModel = activeChat.config.ollamaModel || PREFERRED_MODEL;
      initialEndpoint = activeChat.config.ollamaEndpoint || '';
      initialLlmApiType = activeChat.config.llmApiType || DEFAULT_LLM_API_TYPE;
      initialLlmBearerToken = activeChat.config.llmBearerToken || '';
      initialRequestTimeoutSeconds = normalizeRequestTimeout(activeChat.config.requestTimeoutSeconds);
    } catch (storageError) {
      console.warn('Failed to load MCP client storage:', storageError);
      const fallbackChat = createChatSession({
        anylogUrl: nodeMcpUrl || '',
        ollamaModel: PREFERRED_MODEL,
      });
      initialChats = [fallbackChat];
      setChatSessions(initialChats);
      setActiveChatId(fallbackChat.id);
      activeChatIdRef.current = fallbackChat.id;
      initialAnylogUrl = fallbackChat.config.anylogUrl;
    }

    loadStatus({ initialAnylogUrl, initialEndpoint, initialModel, initialLlmApiType, initialLlmBearerToken });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!nodeMcpUrl || previousNodeMcpUrlRef.current === nodeMcpUrl) return;

    const previousNodeUrl = previousNodeMcpUrlRef.current;
    previousNodeMcpUrlRef.current = nodeMcpUrl;

    if (!userEditedAnylogUrlRef.current || !anylogUrl || anylogUrl === previousNodeUrl) {
      setAnylogUrl(nodeMcpUrl);
      if (connected) {
        setConnected(false);
        setTools([]);
        setStatus((prev) => ({ ...(prev || {}), connected: false, available_tools: [] }));
      }
    }
  }, [anylogUrl, connected, nodeMcpUrl]);

  useEffect(() => {
    answersRef.current = answers;
    if (!activeChatId || applyingChatRef.current) return;

    const persistent = answers.filter((msg) => msg.type === 'user' || msg.type === 'assistant');
    setChatSessions((prev) => prev.map((chat) => {
      if (chat.id !== activeChatId) return chat;
      const existingTitle = chat.title || 'New chat';
      const shouldAutoTitle = existingTitle === 'New chat' || existingTitle.startsWith('Chat ');
      return {
        ...chat,
        title: shouldAutoTitle ? deriveChatTitle(persistent, existingTitle) : existingTitle,
        updatedAt: Date.now(),
        messages: persistent,
        config: {
          anylogUrl,
          ollamaModel,
          ollamaEndpoint,
          llmApiType,
          llmBearerToken,
          requestTimeoutSeconds,
          assistantName,
          instructions,
          mcpTools: tools,
        },
      };
    }));

    try {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(persistent.slice(-40)));
    } catch (storageError) {
      console.warn('Failed to persist MCP chat history:', storageError);
    }
  }, [activeChatId, answers, anylogUrl, ollamaModel, ollamaEndpoint, llmApiType, llmBearerToken, requestTimeoutSeconds, assistantName, instructions, tools]);

  useEffect(() => {
    if (!chatSessions.length) return;
    try {
      localStorage.setItem(CHAT_SESSIONS_STORAGE_KEY, JSON.stringify(chatSessions));
    } catch (storageError) {
      console.warn('Failed to persist MCP chat sessions:', storageError);
    }
  }, [chatSessions]);

  useEffect(() => {
    if (activeChatId) {
      activeChatIdRef.current = activeChatId;
      localStorage.setItem(ACTIVE_CHAT_STORAGE_KEY, activeChatId);
    }
  }, [activeChatId]);

  useEffect(() => {
    const handleStorageCleared = () => {
      const replacement = createChatSession({
        anylogUrl: nodeMcpUrl || '',
        ollamaModel: PREFERRED_MODEL,
      });
      setChatSessions([replacement]);
      setActiveChatId(replacement.id);
      activeChatIdRef.current = replacement.id;
      userEditedAnylogUrlRef.current = false;
      applyChatSession(replacement);
      setPrompt('');
      setError(null);
    };

    window.addEventListener('mcpclient-storage-cleared', handleStorageCleared);
    return () => window.removeEventListener('mcpclient-storage-cleared', handleStorageCleared);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeMcpUrl]);

  useEffect(() => {
    if (skipNextBottomScrollRef.current) {
      skipNextBottomScrollRef.current = false;
      return;
    }
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [answers, streamNote]);

  useEffect(() => {
    if (!pageVisible) return undefined;
    refreshConnectionStatus();
    const intervalId = window.setInterval(() => {
      refreshConnectionStatus();
    }, 15000);
    return () => window.clearInterval(intervalId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageVisible]);

  useEffect(() => {
    try {
      localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify({
        anylogUrl,
        ollamaModel,
        ollamaEndpoint,
        llmApiType,
        llmBearerToken,
        requestTimeoutSeconds,
        assistantName,
        instructions,
        mcpTools: tools,
      }));
    } catch (storageError) {
      console.warn('Failed to persist MCP config:', storageError);
    }
  }, [anylogUrl, ollamaModel, ollamaEndpoint, llmApiType, llmBearerToken, requestTimeoutSeconds, assistantName, instructions, tools]);

  const chooseModel = (availableModels, currentModel) => {
    const names = availableModels.map(getModelName);
    if (currentModel && names.includes(currentModel)) return currentModel;
    return names[0] || '';
  };

  const updateChatConfig = (chatId, patch) => {
    if (!chatId) return;
    setChatSessions((prev) => prev.map((chat) => (
      chat.id === chatId
        ? {
          ...chat,
          updatedAt: Date.now(),
          config: {
            ...(chat.config || {}),
            ...patch,
          },
        }
        : chat
    )));
  };

  const setChatTools = (chatId, nextTools) => {
    const normalizedTools = normalizeToolList(nextTools);
    if (activeChatIdRef.current === chatId) {
      setTools(normalizedTools);
      setStatus((prev) => ({ ...(prev || {}), available_tools: normalizedTools.map((tool) => tool.name) }));
    }
    updateChatConfig(chatId, { mcpTools: normalizedTools });
    return normalizedTools;
  };

  const loadModels = async (endpointOverride = ollamaEndpoint, apiTypeOverride = llmApiType, bearerTokenOverride = llmBearerToken) => {
    const endpoint = normalizeEndpoint(endpointOverride);
    const requestedApiType = apiTypeOverride || DEFAULT_LLM_API_TYPE;
    const bearerToken = bearerTokenOverride || '';
    setLoadingModels(true);
    try {
      const result = await listModels(endpoint, requestedApiType, bearerToken);
      const availableModels = result.models || [];
      const selected = chooseModel(availableModels, ollamaModel);
      setModels(availableModels);
      setModelSource(result.source || (endpoint ? 'remote' : 'local'));
      if (requestedApiType === 'auto' && result.source === 'openai') {
        setLlmApiType('openai');
      }
      setOllamaModel(selected);
      return { models: availableModels, selected };
    } catch (modelError) {
      setModels([]);
      setModelSource(endpoint ? 'remote' : 'local');
      setOllamaModel('');
      setError(`Could not load models: ${modelError.message}`);
      return { models: [], selected: '' };
    } finally {
      setLoadingModels(false);
    }
  };

  const loadStatus = async ({
    initialAnylogUrl = anylogUrl,
    initialEndpoint = ollamaEndpoint,
    initialModel = ollamaModel,
    initialLlmApiType = llmApiType,
    initialLlmBearerToken = llmBearerToken,
  } = {}) => {
    setLoading(true);
    setError(null);
    try {
      const statusData = await getMCPStatus();
      const defaultNodeUrl = nodeMcpUrl || initialAnylogUrl || '';
      const nextAnylogUrl = statusData.connected
        ? (statusData.anylog_url || defaultNodeUrl)
        : defaultNodeUrl;
      const nextEndpoint = statusData.llm_endpoint || initialEndpoint || '';
      const nextModel = statusData.current_model || initialModel || PREFERRED_MODEL;
      const nextApiType = statusData.llm_api_type || initialLlmApiType || DEFAULT_LLM_API_TYPE;

      setStatus(statusData);
      setConnected(Boolean(statusData.connected));
      setAnylogUrl(nextAnylogUrl);
      setOllamaEndpoint(nextEndpoint);
      setLlmApiType(nextApiType);
      setOllamaModel(nextModel);

      const loaded = await loadModels(nextEndpoint, nextApiType, initialLlmBearerToken);
      const selectedModel = loaded.selected || nextModel;

      if (statusData.available_tools?.length) {
        setChatTools(activeChatIdRef.current, statusData.available_tools);
      }

      if (!statusData.connected && selectedModel && nextAnylogUrl) {
        try {
          setConnecting(true);
          const result = await connectMCP(nextAnylogUrl, selectedModel, normalizeEndpoint(nextEndpoint), nextApiType, initialLlmBearerToken);
          setConnected(true);
          setStatus({ ...statusData, connected: true, available_tools: result.available_tools || [] });
          setChatTools(activeChatIdRef.current, result.available_tools || []);
        } catch (connectError) {
          setConnected(false);
          setError(`Auto-connect failed for ${nextAnylogUrl}: ${connectError.message}`);
        } finally {
          setConnecting(false);
        }
      }
    } catch (statusError) {
      setError(`Failed to load MCP status: ${statusError.message}`);
      await loadModels(initialEndpoint, initialLlmApiType, initialLlmBearerToken);
    } finally {
      setLoading(false);
    }
  };

  const loadTools = async () => {
    try {
      const toolsData = await listMCPTools();
      setChatTools(activeChatIdRef.current, toolsData.tools || []);
    } catch (toolsError) {
      console.warn('Failed to load MCP tools:', toolsError);
    }
  };

  const handleConnect = async () => {
    setConnecting(true);
    setError(null);
    try {
      const endpoint = normalizeEndpoint(ollamaEndpoint);
      const result = await connectMCP(anylogUrl || null, ollamaModel || null, endpoint, llmApiType, llmBearerToken);
      setConnected(true);
      setStatus({
        ...(status || {}),
        connected: true,
        current_model: ollamaModel,
        anylog_url: anylogUrl,
        llm_endpoint: endpoint,
        llm_api_type: llmApiType,
        available_tools: result.available_tools || [],
      });
      setChatTools(activeChatIdRef.current, result.available_tools || []);
      if (!result.available_tools?.length) await loadTools();
      setShowConfig(false);
    } catch (connectError) {
      setConnected(false);
      setError(connectError.message || 'Failed to connect to MCP.');
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    setConnecting(true);
    setError(null);
    try {
      await disconnectMCP();
      setConnected(false);
      setChatTools(activeChatIdRef.current, []);
      setStatus({ ...(status || {}), connected: false, available_tools: [] });
    } catch (disconnectError) {
      setError(disconnectError.message || 'Failed to disconnect.');
    } finally {
      setConnecting(false);
    }
  };

  const handleRefreshModels = async () => {
    setError(null);
    await loadModels(ollamaEndpoint, llmApiType, llmBearerToken);
  };

  const updateChatMessages = (chatId, updater) => {
    const isActiveChat = activeChatIdRef.current === chatId;
    const activeNextMessages = isActiveChat
      ? updater(normalizeMessages(answersRef.current))
      : null;

    if (activeNextMessages) {
      setAnswers(activeNextMessages);
      answersRef.current = activeNextMessages;
    }

    setChatSessions((prev) => prev.map((chat) => {
      if (chat.id !== chatId) return chat;
      const nextMessages = activeNextMessages || updater(normalizeMessages(chat.messages));
      return {
        ...chat,
        messages: nextMessages,
        updatedAt: Date.now(),
        title: chat.title === 'New chat' || chat.title?.startsWith('Chat ')
          ? deriveChatTitle(nextMessages, chat.title || 'New chat')
        : chat.title,
      };
    }));
  };

  const updateAssistantMessage = (chatId, id, updater) => {
    updateChatMessages(chatId, (messages) => messages.map((msg) => (
      msg.id === id ? { ...msg, ...updater(msg) } : msg
    )));
  };

  const updateObservation = (chatId, assistantId, event) => {
    updateAssistantMessage(chatId, assistantId, (msg) => {
      const observations = msg.observations || [];
      const requestId = event.request_id || event.requestId || `${event.tool_name || 'mcp'}-${observations.length}`;
      const existingIndex = observations.findIndex((item) => item.id === requestId);
      const existing = existingIndex >= 0 ? observations[existingIndex] : {};
      const nextObservation = {
        ...existing,
        id: requestId,
        toolName: event.tool_name || event.toolName || existing.toolName,
        arguments: event.arguments ?? existing.arguments,
        response: event.response ?? existing.response,
        error: event.error ?? existing.error,
        exception: event.exception ?? event.traceback ?? existing.exception,
        elapsedMs: event.elapsed_ms ?? event.elapsedMs ?? existing.elapsedMs,
        totalElapsedMs: event.total_elapsed_ms ?? event.totalElapsedMs ?? existing.totalElapsedMs,
        iteration: event.iteration ?? existing.iteration,
        status: event.type === 'mcp_request' ? 'pending' : event.type === 'mcp_error' ? 'error' : 'complete',
      };

      const nextObservations = existingIndex >= 0
        ? observations.map((item, index) => (index === existingIndex ? nextObservation : item))
        : [...observations, nextObservation];

      return {
        observations: nextObservations,
        totalElapsedMs: event.total_elapsed_ms ?? event.elapsed_ms ?? msg.totalElapsedMs,
      };
    });
  };

  const toggleObservations = (assistantId) => {
    const currentMessage = normalizeMessages(answersRef.current).find((msg) => msg.id === assistantId);
    const willShow = !currentMessage?.showObservations;
    skipNextBottomScrollRef.current = true;
    updateAssistantMessage(activeChatIdRef.current, assistantId, (msg) => ({
      showObservations: !msg.showObservations,
    }));
    if (willShow) {
      window.setTimeout(() => {
        observationPanelRefs.current[assistantId]?.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
      }, 0);
    }
  };

  const handleAsk = async (retryPrompt = null) => {
    const userPrompt = retryPrompt || prompt.trim();
    const requestChatId = activeChatIdRef.current;
    if (!userPrompt || !requestChatId || runningChatIds.includes(requestChatId)) return;
    if (!ollamaModel.trim()) {
      setError('Select or enter an Ollama model before asking.');
      return;
    }

    const requestChat = chatSessions.find((chat) => chat.id === requestChatId);
    const requestMessages = normalizeMessages(requestChat?.messages || answersRef.current);
    const requestConfig = {
      anylogUrl,
      ollamaModel,
      ollamaEndpoint,
      llmApiType,
      llmBearerToken,
      requestTimeoutSeconds: normalizeRequestTimeout(requestTimeoutSeconds),
      instructions,
    };
    const promptForModel = requestConfig.instructions?.trim()
      ? `Instructions:\n${requestConfig.instructions.trim()}\n\nUser request:\n${userPrompt}`
      : userPrompt;

    const conversationHistory = requestMessages
      .filter((msg) => msg.type === 'user' || msg.type === 'assistant')
      .map((msg) => ({
        role: msg.type === 'user' ? 'user' : 'assistant',
        content: msg.content,
      }));

    if (!retryPrompt) setPrompt('');
    setRunningChatIds((prev) => (prev.includes(requestChatId) ? prev : [...prev, requestChatId]));
    setError(null);
    setStreamNote('Preparing request');

    const assistantId = `assistant-${Date.now()}`;
    const userMessage = { type: 'user', content: userPrompt, id: `user-${Date.now()}` };
    const assistantMessage = {
      type: 'assistant',
      content: '',
      id: assistantId,
      streaming: true,
      observations: [],
      showObservations: false,
      totalElapsedMs: 0,
    };
    updateChatMessages(requestChatId, (messages) => [...messages, userMessage, assistantMessage]);

    const abortController = new AbortController();
    abortControllersRef.current[requestChatId] = abortController;
    streamRequestIdsRef.current[requestChatId] = assistantId;
    let streamError = '';
    let streamErrorEvent = null;

    try {
      const endpoint = normalizeEndpoint(requestConfig.ollamaEndpoint);
      const streamResult = await askMCPStream({
        prompt: promptForModel,
        anylogSseUrl: requestConfig.anylogUrl || null,
        ollamaModel: requestConfig.ollamaModel || null,
        conversationHistory: conversationHistory.length ? conversationHistory : null,
        llmEndpoint: endpoint,
        llmApiType: requestConfig.llmApiType || DEFAULT_LLM_API_TYPE,
        streamRequestId: assistantId,
        timeoutSeconds: requestConfig.requestTimeoutSeconds,
        llmBearerToken: requestConfig.llmBearerToken,
        abortSignal: abortController.signal,
        onEvent: (event) => {
          if (event.type === 'status') {
            setStreamNote(event.message || '');
          }
          if (event.type === 'tools') {
            setChatTools(requestChatId, event.tools || []);
          }
          if (event.type === 'command_start') {
            updateAssistantMessage(requestChatId, assistantId, () => ({
              totalElapsedMs: 0,
            }));
          }
          if (event.type === 'mcp_request' || event.type === 'mcp_response' || event.type === 'mcp_error') {
            updateObservation(requestChatId, assistantId, event);
          }
          if (event.type === 'command_done') {
            updateAssistantMessage(requestChatId, assistantId, () => ({
              totalElapsedMs: event.elapsed_ms || 0,
            }));
          }
          if (event.type === 'delta') {
            updateAssistantMessage(requestChatId, assistantId, (msg) => ({
              content: `${msg.content || ''}${event.content || ''}`,
              streaming: true,
            }));
          }
          if (event.type === 'done') {
            updateAssistantMessage(requestChatId, assistantId, () => ({
              content: event.answer || '',
              streaming: false,
              totalElapsedMs: event.elapsed_ms || undefined,
            }));
            setStreamNote('');
          }
          if (event.type === 'error') {
            streamError = event.message || 'Streaming request failed.';
            streamErrorEvent = event;
          }
        },
      });

      if (streamError) {
        const error = new Error(streamError);
        error.exception = streamErrorEvent?.exception || streamErrorEvent?.traceback || '';
        error.event = streamErrorEvent;
        throw error;
      }
      updateAssistantMessage(requestChatId, assistantId, (msg) => ({
        content: msg.content || streamResult.answer || '',
        streaming: false,
      }));
    } catch (askError) {
      if (askError.name === 'AbortError' || askError.message?.includes('aborted')) {
        updateChatMessages(requestChatId, (messages) => messages.filter((msg) => msg.id !== assistantId));
        setStreamNote('');
      } else if (askError.streamDisconnected) {
        setError(`${askError.message || 'The response stream disconnected.'} The backend request may still be running; reconnect will resume when the stream is available.`);
        updateAssistantMessage(requestChatId, assistantId, (msg) => ({
          type: 'error',
          content: msg.content || 'The response stream disconnected before completion.',
          exception: askError.exception || askError.stack || '',
          streaming: false,
          showObservations: true,
        }));
      } else if ((requestConfig.llmApiType || DEFAULT_LLM_API_TYPE) === 'openai') {
        setError(askError.message || 'Failed to process question.');
        updateChatMessages(requestChatId, (messages) => messages.map((msg) => (
          msg.id === assistantId
            ? {
              ...msg,
              type: 'error',
              content: askError.message || 'Failed to process question.',
              exception: askError.exception || askError.stack || '',
              failedPrompt: userPrompt,
              streaming: false,
              showObservations: true,
            }
            : msg
        )));
      } else {
        try {
          const fallback = await askMCP(
            promptForModel,
            requestConfig.anylogUrl || null,
            requestConfig.ollamaModel || null,
            conversationHistory.length ? conversationHistory : null,
            normalizeEndpoint(requestConfig.ollamaEndpoint),
            requestConfig.llmApiType || DEFAULT_LLM_API_TYPE,
            abortController.signal,
            requestConfig.requestTimeoutSeconds,
            requestConfig.llmBearerToken
          );
          updateAssistantMessage(requestChatId, assistantId, () => ({
            content: fallback.answer || fallback.content || '',
            streaming: false,
          }));
        } catch (fallbackError) {
          setError(fallbackError.message || askError.message || 'Failed to process question.');
          updateChatMessages(requestChatId, (messages) => messages.map((msg) => (
            msg.id === assistantId
              ? {
                ...msg,
                type: 'error',
                content: fallbackError.message || askError.message,
                exception: fallbackError.exception || fallbackError.stack || askError.exception || askError.stack || '',
                failedPrompt: userPrompt,
                streaming: false,
                showObservations: true,
              }
              : msg
          )));
        }
      }
    } finally {
      setRunningChatIds((prev) => prev.filter((chatId) => chatId !== requestChatId));
      setStreamNote('');
      delete abortControllersRef.current[requestChatId];
      delete streamRequestIdsRef.current[requestChatId];
    }
  };

  const handleCancel = async (chatId = activeChatIdRef.current) => {
    const streamRequestId = streamRequestIdsRef.current[chatId];
    abortControllersRef.current[chatId]?.abort();
    delete abortControllersRef.current[chatId];
    delete streamRequestIdsRef.current[chatId];
    if (streamRequestId) {
      try {
        await cancelMCPStream(streamRequestId);
      } catch (cancelError) {
        setError(cancelError.message || 'Failed to cancel request.');
      }
    }
    setRunningChatIds((prev) => prev.filter((runningChatId) => runningChatId !== chatId));
    setStreamNote('');
  };

  const handleSelectChat = (chatId) => {
    const chat = chatSessions.find((item) => item.id === chatId);
    if (!chat) return;
    setActiveChatId(chat.id);
    activeChatIdRef.current = chat.id;
    userEditedAnylogUrlRef.current = Boolean(chat.config?.anylogUrl && chat.config.anylogUrl !== nodeMcpUrl);
    applyChatSession(chat);
    setError(null);
  };

  const handleNewChat = () => {
    const sessionNumber = chatSessions.length + 1;
    const newChat = createChatSession({
      title: `Chat ${sessionNumber}`,
      anylogUrl: nodeMcpUrl || anylogUrl || '',
      ollamaModel: ollamaModel || PREFERRED_MODEL,
      ollamaEndpoint,
      llmApiType,
      llmBearerToken,
      requestTimeoutSeconds,
      assistantName: assistantName || DEFAULT_ASSISTANT_NAME,
      instructions,
      mcpTools: tools,
    });

    setChatSessions((prev) => [...prev, newChat]);
    setActiveChatId(newChat.id);
    activeChatIdRef.current = newChat.id;
    userEditedAnylogUrlRef.current = Boolean(newChat.config.anylogUrl && newChat.config.anylogUrl !== nodeMcpUrl);
    applyChatSession(newChat);
    setPrompt('');
    setError(null);
  };

  const handleDeleteChat = (chatId = activeChatId) => {
    if (runningChatIds.includes(chatId)) {
      setError('Stop the running request before deleting this chat.');
      return;
    }
    const chat = chatSessions.find((item) => item.id === chatId);
    if (!chat) return;
    if (!window.confirm(`Delete "${chat.title || 'this chat'}"? This cannot be undone.`)) return;

    const remaining = chatSessions.filter((item) => item.id !== chatId);
    if (remaining.length === 0) {
      const replacement = createChatSession({
        anylogUrl: nodeMcpUrl || '',
        ollamaModel: PREFERRED_MODEL,
      });
      setChatSessions([replacement]);
      setActiveChatId(replacement.id);
      activeChatIdRef.current = replacement.id;
      userEditedAnylogUrlRef.current = false;
      applyChatSession(replacement);
      return;
    }

    setChatSessions(remaining);
    if (chatId === activeChatId) {
      const nextChat = remaining[0];
      setActiveChatId(nextChat.id);
      activeChatIdRef.current = nextChat.id;
      userEditedAnylogUrlRef.current = Boolean(nextChat.config?.anylogUrl && nextChat.config.anylogUrl !== nodeMcpUrl);
      applyChatSession(nextChat);
    }
  };

  const handleClearHistory = () => {
    if (runningChatIds.includes(activeChatId)) {
      setError('Stop the running request before clearing this chat.');
      return;
    }
    if (!window.confirm('Clear this chat history?')) return;
    setAnswers([]);
    localStorage.removeItem(HISTORY_STORAGE_KEY);
  };

  const handleRenameActiveChat = (title) => {
    setChatSessions((prev) => prev.map((chat) => (
      chat.id === activeChatId
        ? { ...chat, title: title || 'New chat', updatedAt: Date.now() }
        : chat
    )));
  };

  const handleSaveInstructions = () => {
    setChatSessions((prev) => prev.map((chat) => (
      chat.id === activeChatId
        ? {
          ...chat,
          updatedAt: Date.now(),
          config: {
            ...(chat.config || {}),
            instructions,
          },
        }
        : chat
    )));
    setInstructionsSaved(true);
    setTimeout(() => setInstructionsSaved(false), 1800);
  };

  const handleExportToPDF = async () => {
    if (!answers.length) {
      setError('No chat history to export.');
      return;
    }

    try {
      const { default: jsPDF } = await import('jspdf');
      const doc = new jsPDF();
      const margin = 18;
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const maxWidth = pageWidth - margin * 2;
      let y = margin;

      const writeWrapped = (text, size = 9, style = 'normal') => {
        doc.setFont('helvetica', style);
        doc.setFontSize(size);
        const lines = doc.splitTextToSize(text, maxWidth);
        lines.forEach((line) => {
          if (y > pageHeight - margin) {
            doc.addPage();
            y = margin;
          }
          doc.text(line, margin, y);
          y += size * 0.45 + 3;
        });
      };

      writeWrapped('MCP Client Chat Export', 18, 'bold');
      writeWrapped(`Exported: ${new Date().toLocaleString()}`, 9);
      writeWrapped(`Model: ${ollamaModel || 'Not selected'}`, 9);
      writeWrapped(`LLM endpoint: ${normalizeEndpoint(ollamaEndpoint) || 'Backend local Ollama'}`, 9);
      y += 4;

      answers
        .filter((msg) => msg.type !== 'thinking')
        .forEach((msg) => {
          const role = msg.type === 'user' ? 'You' : msg.type === 'error' ? 'Error' : 'Assistant';
          if (y > pageHeight - margin - 20) {
            doc.addPage();
            y = margin;
          }
          doc.setTextColor(msg.type === 'error' ? 180 : 30, msg.type === 'user' ? 90 : 30, msg.type === 'assistant' ? 90 : 30);
          writeWrapped(role, 11, 'bold');
          doc.setTextColor(0, 0, 0);
          writeWrapped(stripMarkdown(msg.content), 9);
          y += 5;
        });

      doc.save(`mcp-chat-${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (pdfError) {
      setError(`Failed to export PDF: ${pdfError.message}`);
    }
  };

  const canConnect = Boolean(anylogUrl.trim() && ollamaModel.trim() && !connecting);
  const endpointLabel = normalizeEndpoint(ollamaEndpoint) || 'Backend local Ollama';
  const activeChatRunning = runningChatIds.includes(activeChatId);
  const activeChat = chatSessions.find((chat) => chat.id === activeChatId);
  const canSendPrompt = Boolean(anylogUrl.trim() && ollamaModel.trim() && !activeChatRunning);
  const modelNames = useMemo(() => models.map(getModelName).filter(Boolean), [models]);
  const selectedModelListed = modelNames.includes(ollamaModel);

  return (
    <div className="mcp-page">
      <style>{`
        .mcp-page {
          height: 100vh;
          width: 100%;
          display: flex;
          flex-direction: column;
          background: #eef2f6;
          color: #172033;
          overflow: hidden;
        }
        .mcp-topbar {
          min-height: 72px;
          padding: 14px 20px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 16px;
          background: #101828;
          color: #ffffff;
          border-bottom: 1px solid #24324a;
        }
        .mcp-title {
          display: flex;
          align-items: center;
          gap: 12px;
          min-width: 0;
        }
        .mcp-title h2 {
          margin: 0;
          font-size: 20px;
          line-height: 1.2;
          letter-spacing: 0;
        }
        .mcp-title p {
          margin: 3px 0 0;
          color: #b8c3d8;
          font-size: 13px;
        }
        .mcp-actions {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
          justify-content: flex-end;
        }
        .mcp-layout {
          flex: 1;
          min-height: 0;
          display: grid;
          grid-template-columns: 330px minmax(0, 1fr);
        }
        .mcp-layout.config-expanded {
          grid-template-columns: minmax(0, 1fr);
          place-items: start center;
          overflow: auto;
          padding: 18px;
        }
        .mcp-sidebar {
          min-height: 0;
          overflow: auto;
          padding: 18px;
          background: #ffffff;
          border-right: 1px solid #d7dde8;
        }
        .mcp-layout.config-expanded .mcp-sidebar {
          width: min(1080px, 100%);
          max-height: calc(100vh - 108px);
          box-sizing: border-box;
          display: grid;
          grid-template-columns: minmax(280px, 360px) minmax(0, 1fr);
          gap: 14px;
          border: 1px solid #d7dde8;
          border-radius: 10px;
          box-shadow: 0 20px 48px rgba(16, 24, 40, 0.14);
        }
        .mcp-layout.config-expanded .mcp-sidebar .panel:nth-child(1) {
          grid-row: 1 / span 2;
        }
        .mcp-layout.config-expanded .mcp-sidebar .panel:nth-child(2),
        .mcp-layout.config-expanded .mcp-sidebar .panel:nth-child(3) {
          grid-column: 2;
        }
        .mcp-layout.config-expanded .mcp-sidebar .panel:nth-child(3) {
          margin-top: 0 !important;
        }
        .mcp-layout.config-expanded .mcp-sidebar .panel:nth-child(2) .panel-body {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          column-gap: 14px;
          align-items: start;
        }
        .mcp-layout.config-expanded .status-grid,
        .mcp-layout.config-expanded .field-wide,
        .mcp-layout.config-expanded .panel:nth-child(2) .panel-body > .secondary-button {
          grid-column: 1 / -1;
        }
        .mcp-layout.config-expanded .mcp-workspace {
          display: none;
        }
        .mcp-workspace {
          min-width: 0;
          min-height: 0;
          display: flex;
          flex-direction: column;
          padding: 18px;
          gap: 14px;
        }
        .panel {
          background: #ffffff;
          border: 1px solid #d7dde8;
          border-radius: 8px;
          box-shadow: 0 10px 28px rgba(16, 24, 40, 0.06);
        }
        .panel-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding: 13px 14px;
          border-bottom: 1px solid #e5e9f1;
          font-weight: 700;
          font-size: 14px;
        }
        .panel-body {
          padding: 14px;
        }
        .field {
          margin-bottom: 14px;
        }
        .field label {
          display: block;
          font-size: 12px;
          color: #46556e;
          font-weight: 700;
          margin-bottom: 6px;
        }
        .field input,
        .field select,
        .field textarea {
          width: 100%;
          box-sizing: border-box;
          border: 1px solid #c8d1df;
          border-radius: 6px;
          padding: 10px 11px;
          font: inherit;
          color: #172033;
          background: #fbfcfe;
        }
        .field input:focus,
        .field select:focus,
        .chat-input textarea:focus {
          outline: 2px solid #89b4ff;
          outline-offset: 1px;
          border-color: #3b82f6;
        }
        .model-picker {
          display: grid;
          gap: 8px;
        }
        .model-picker select {
          background: #ffffff;
        }
        .model-empty {
          border: 1px dashed #c8d1df;
          border-radius: 6px;
          padding: 10px 11px;
          color: #66748b;
          background: #fbfcfe;
          font-size: 13px;
        }
        .hint {
          margin-top: 6px;
          color: #66748b;
          font-size: 12px;
          line-height: 1.4;
        }
        .status-grid {
          display: grid;
          gap: 8px;
          margin-bottom: 14px;
        }
        .chat-session-list {
          display: grid;
          gap: 8px;
          max-height: 220px;
          overflow: auto;
          margin-bottom: 12px;
        }
        .chat-session-button {
          width: 100%;
          border: 1px solid #d7dde8;
          border-radius: 6px;
          background: #ffffff;
          color: #172033;
          padding: 9px 10px;
          text-align: left;
          cursor: pointer;
        }
        .chat-session-button.active {
          border-color: #2563eb;
          background: #eff6ff;
        }
        .chat-session-title {
          display: block;
          font-size: 13px;
          font-weight: 800;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .chat-session-meta {
          display: block;
          margin-top: 3px;
          color: #66748b;
          font-size: 11px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .chat-session-actions {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 8px;
        }
        .status-row {
          display: flex;
          justify-content: space-between;
          gap: 10px;
          color: #46556e;
          font-size: 13px;
        }
        .status-row strong {
          color: #172033;
          text-align: right;
          word-break: break-word;
        }
        .tools-list {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          max-height: 146px;
          overflow: auto;
        }
        .tool-chip,
        .status-pill {
          border-radius: 999px;
          padding: 6px 9px;
          font-size: 12px;
          font-weight: 700;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          white-space: nowrap;
        }
        .tool-chip {
          background: #edf2f7;
          color: #344054;
        }
        .status-pill.connected {
          color: #0f5132;
          background: #d1fae5;
        }
        .status-pill.disconnected {
          color: #842029;
          background: #fde2e2;
        }
        .primary-button,
        .secondary-button,
        .danger-button,
        .icon-action {
          border: 0;
          border-radius: 6px;
          min-height: 38px;
          padding: 9px 12px;
          font: inherit;
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
        }
        .primary-button {
          color: #ffffff;
          background: #2563eb;
        }
        .secondary-button {
          color: #172033;
          background: #e8eef7;
        }
        .danger-button {
          color: #ffffff;
          background: #dc2626;
        }
        .icon-action {
          color: #24324a;
          background: #f1f5f9;
          border: 1px solid #d7dde8;
        }
        button:disabled {
          cursor: not-allowed;
          opacity: 0.55;
        }
        .error-banner {
          padding: 12px 14px;
          color: #842029;
          background: #fff1f2;
          border: 1px solid #fecdd3;
          border-radius: 8px;
          display: flex;
          gap: 10px;
          align-items: flex-start;
          font-size: 13px;
        }
        .chat-panel {
          flex: 1;
          min-height: 0;
          display: flex;
          flex-direction: column;
        }
        .messages {
          flex: 1;
          min-height: 0;
          overflow: auto;
          padding: 18px;
        }
        .empty-state {
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #66748b;
          text-align: center;
        }
        .message {
          margin-bottom: 14px;
          border-radius: 8px;
          border: 1px solid #dfe5ee;
          overflow: hidden;
          background: #ffffff;
        }
        .message-wrap {
          display: grid;
          grid-template-columns: 38px minmax(0, 1fr);
          gap: 10px;
          align-items: start;
          margin-bottom: 14px;
        }
        .message-wrap .message {
          margin-bottom: 0;
        }
        .message-info-button {
          width: 34px;
          height: 34px;
          margin-top: 8px;
          border-radius: 999px;
          border: 1px solid #c8d1df;
          background: #ffffff;
          color: #2563eb;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
        }
        .message-info-button.active {
          background: #2563eb;
          color: #ffffff;
          border-color: #2563eb;
        }
        .message.user {
          border-color: #bfdbfe;
          background: #f8fbff;
        }
        .message.error {
          border-color: #fecdd3;
          background: #fff8f8;
        }
        .message-header {
          display: flex;
          justify-content: space-between;
          gap: 10px;
          padding: 10px 12px;
          background: #f8fafc;
          color: #344054;
          font-size: 12px;
          font-weight: 800;
          text-transform: uppercase;
        }
        .message-body {
          padding: 13px 14px;
          line-height: 1.6;
          overflow-wrap: anywhere;
        }
        .stream-cursor {
          display: inline-block;
          width: 8px;
          height: 16px;
          margin-left: 2px;
          vertical-align: text-bottom;
          background: #2563eb;
          animation: blink 1s step-end infinite;
        }
        @keyframes blink {
          50% { opacity: 0; }
        }
        .stream-note {
          color: #66748b;
          font-size: 12px;
          margin-top: 8px;
        }
        .message-error-content {
          display: grid;
          gap: 10px;
        }
        .error-summary-text {
          color: #7f1d1d;
          font-weight: 700;
          white-space: pre-wrap;
          word-break: break-word;
        }
        .exception-details summary {
          cursor: pointer;
          color: #7f1d1d;
          font-size: 12px;
          font-weight: 800;
        }
        .exception-details pre {
          margin: 8px 0 0;
          padding: 10px;
          max-height: 320px;
          overflow: auto;
          border-radius: 6px;
          background: #111827;
          color: #fee2e2;
          font-size: 12px;
          line-height: 1.45;
          white-space: pre-wrap;
          word-break: break-word;
        }
        .observation-panel {
          margin-top: 12px;
          border: 1px solid #c8d1df;
          border-radius: 8px;
          background: #f8fafc;
          overflow: hidden;
        }
        .observation-summary {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          padding: 10px 12px;
          border-bottom: 1px solid #dfe5ee;
          font-size: 13px;
          font-weight: 800;
          color: #24324a;
        }
        .observation-empty {
          padding: 12px;
          color: #66748b;
          font-size: 13px;
        }
        .observation-list {
          display: grid;
          gap: 10px;
          padding: 10px;
          max-height: 420px;
          overflow: auto;
        }
        .observation-item {
          border: 1px solid #d7dde8;
          border-left: 4px solid #94a3b8;
          border-radius: 6px;
          background: #ffffff;
          padding: 10px;
        }
        .observation-item.complete {
          border-left-color: #16a34a;
        }
        .observation-item.error {
          border-left-color: #dc2626;
        }
        .observation-meta {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 8px;
          color: #46556e;
          font-size: 12px;
          margin-bottom: 8px;
        }
        .observation-meta strong {
          color: #172033;
          font-size: 13px;
        }
        .observation-item details {
          margin-top: 8px;
        }
        .observation-item summary {
          cursor: pointer;
          font-size: 12px;
          font-weight: 800;
          color: #344054;
        }
        .observation-item pre {
          margin: 8px 0 0;
          padding: 10px;
          max-height: 260px;
          overflow: auto;
          border-radius: 6px;
          background: #0f172a;
          color: #dbeafe;
          font-size: 12px;
          line-height: 1.45;
          white-space: pre-wrap;
          word-break: break-word;
        }
        .chat-input {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 10px;
          padding: 14px;
          border-top: 1px solid #e5e9f1;
        }
        .chat-input textarea {
          min-height: 64px;
          max-height: 180px;
          resize: vertical;
          box-sizing: border-box;
          border: 1px solid #c8d1df;
          border-radius: 6px;
          padding: 11px;
          font: inherit;
        }
        .artifact-panel {
          margin-top: 12px;
          border: 1px solid #d7dde8;
          border-radius: 8px;
          overflow: hidden;
          background: #fbfcfe;
        }
        .artifact-header,
        .artifact-title,
        .artifact-files,
        .artifact-file {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .artifact-header {
          justify-content: space-between;
          padding: 10px 12px;
          border-bottom: 1px solid #e5e9f1;
        }
        .artifact-title {
          font-weight: 800;
          font-size: 13px;
        }
        .artifact-preview {
          display: block;
          width: 100%;
          height: 360px;
          border: 0;
          background: #ffffff;
        }
        .artifact-files {
          flex-wrap: wrap;
          padding: 10px 12px;
          border-top: 1px solid #e5e9f1;
        }
        .artifact-file {
          border: 1px solid #c8d1df;
          background: #ffffff;
          color: #24324a;
          border-radius: 6px;
          padding: 7px 9px;
          font-weight: 700;
          cursor: pointer;
        }
        .mcp-page {
          --mcp-page-bg: var(--color-bg, #eef2f6);
          --mcp-topbar-bg: #101828;
          --mcp-topbar-text: #ffffff;
          --mcp-sidebar-bg: var(--color-surface, #ffffff);
          --mcp-panel-bg: var(--color-surface, #ffffff);
          --mcp-panel-muted-bg: var(--color-surface-muted, #f8fafc);
          --mcp-input-bg: #fbfcfe;
          --mcp-message-bg: var(--color-surface, #ffffff);
          --mcp-user-message-bg: #f8fbff;
          --mcp-border: var(--color-border, #d7dde8);
          --mcp-text: var(--color-text, #172033);
          --mcp-heading: var(--color-heading, #172033);
          --mcp-muted: var(--color-text-muted, #66748b);
          --mcp-primary: var(--color-primary, #2563eb);
          --mcp-primary-contrast: var(--color-primary-contrast, #ffffff);
          --component-code-bg: #f4f4f4;
          --component-code-text: #172033;
        }
        :root[data-theme='dark'] .mcp-page {
          --mcp-page-bg: #050914;
          --mcp-topbar-bg: #071527;
          --mcp-topbar-text: #ffffff;
          --mcp-sidebar-bg: #0a1220;
          --mcp-panel-bg: #0d1524;
          --mcp-panel-muted-bg: #172238;
          --mcp-input-bg: #07111f;
          --mcp-message-bg: #101a2b;
          --mcp-user-message-bg: rgba(102, 179, 255, 0.14);
          --mcp-border: #37506f;
          --mcp-text: #f7fbff;
          --mcp-heading: #ffffff;
          --mcp-muted: #c4cfdf;
          --mcp-primary: #66b3ff;
          --mcp-primary-contrast: #04111f;
          --component-code-bg: #07111f;
          --component-code-text: #e6f1ff;
        }
        .mcp-page {
          background: var(--mcp-page-bg);
          color: var(--mcp-text);
        }
        .mcp-page .mcp-topbar {
          background: var(--mcp-topbar-bg);
          color: var(--mcp-topbar-text);
          border-color: var(--mcp-border);
        }
        .mcp-page .mcp-title p {
          color: var(--mcp-muted);
        }
        .mcp-page .mcp-sidebar {
          background: var(--mcp-sidebar-bg);
          border-color: var(--mcp-border);
        }
        .mcp-page .mcp-workspace {
          background: var(--mcp-page-bg);
          color: var(--mcp-text);
        }
        .mcp-page .panel,
        .mcp-page .artifact-panel,
        .mcp-page .observation-panel {
          background: var(--mcp-panel-bg);
          border-color: var(--mcp-border);
          color: var(--mcp-text);
          box-shadow: var(--shadow-card, 0 10px 28px rgba(16, 24, 40, 0.06));
        }
        .mcp-page .panel-header,
        .mcp-page .message-header,
        .mcp-page .observation-summary,
        .mcp-page .chat-input,
        .mcp-page .artifact-header,
        .mcp-page .artifact-files {
          background: var(--mcp-panel-muted-bg);
          border-color: var(--mcp-border);
          color: var(--mcp-heading);
        }
        .mcp-page .field label,
        .mcp-page .status-row,
        .mcp-page .observation-meta,
        .mcp-page .hint,
        .mcp-page .chat-session-meta,
        .mcp-page .empty-state,
        .mcp-page .stream-note,
        .mcp-page .observation-empty {
          color: var(--mcp-muted);
        }
        .mcp-page .status-row strong,
        .mcp-page .observation-meta strong,
        .mcp-page .artifact-title,
        .mcp-page .chat-session-title {
          color: var(--mcp-heading);
        }
        .mcp-page .field input,
        .mcp-page .field select,
        .mcp-page .field textarea,
        .mcp-page .chat-input textarea,
        .mcp-page .model-picker select {
          background: var(--mcp-input-bg);
          border-color: var(--mcp-border);
          color: var(--mcp-text);
        }
        .mcp-page .field select option,
        .mcp-page .model-picker select option {
          background: var(--mcp-input-bg);
          color: var(--mcp-text);
        }
        .mcp-page .field input:focus,
        .mcp-page .field select:focus,
        .mcp-page .field textarea:focus,
        .mcp-page .chat-input textarea:focus {
          border-color: var(--mcp-primary);
          box-shadow: var(--focus-ring);
          outline: none;
        }
        .mcp-page .model-empty,
        .mcp-page .chat-session-button,
        .mcp-page .message-info-button,
        .mcp-page .artifact-file,
        .mcp-page .observation-item {
          background: var(--mcp-panel-bg);
          border-color: var(--mcp-border);
          color: var(--mcp-text);
        }
        .mcp-page .chat-session-button.active,
        .mcp-page .message-info-button.active {
          background: rgba(102, 179, 255, 0.2);
          border-color: var(--mcp-primary);
          color: var(--mcp-primary);
        }
        .mcp-page .message {
          background: var(--mcp-message-bg);
          border-color: var(--mcp-border);
          color: var(--mcp-text);
        }
        .mcp-page .message.user {
          background: var(--mcp-user-message-bg);
          border-color: var(--mcp-primary);
        }
        .mcp-page .message.error,
        .mcp-page .error-banner {
          background: var(--color-error-bg);
          border-color: #b84250;
          color: var(--color-error-text);
        }
        .mcp-page .error-summary-text,
        .mcp-page .exception-details summary {
          color: var(--color-error-text);
        }
        .mcp-page .tool-chip {
          background: var(--mcp-panel-muted-bg);
          color: var(--mcp-heading);
        }
        .mcp-page .secondary-button,
        .mcp-page .icon-action {
          background: var(--mcp-panel-muted-bg);
          border-color: var(--mcp-border);
          color: var(--mcp-heading);
        }
        .mcp-page .primary-button {
          background: var(--mcp-primary);
          color: var(--mcp-primary-contrast);
        }
        .mcp-page .artifact-preview {
          background: var(--mcp-panel-bg);
        }
        @media (max-width: 980px) {
          .mcp-layout {
            grid-template-columns: 1fr;
          }
          .mcp-layout.config-expanded {
            padding: 12px;
          }
          .mcp-sidebar {
            max-height: 42vh;
            border-right: 0;
            border-bottom: 1px solid #d7dde8;
          }
          .mcp-layout.config-expanded .mcp-sidebar {
            max-height: none;
            grid-template-columns: 1fr;
          }
          .mcp-layout.config-expanded .mcp-sidebar .panel:nth-child(1),
          .mcp-layout.config-expanded .mcp-sidebar .panel:nth-child(2),
          .mcp-layout.config-expanded .mcp-sidebar .panel:nth-child(3) {
            grid-column: 1;
            grid-row: auto;
          }
          .mcp-layout.config-expanded .mcp-sidebar .panel:nth-child(2) .panel-body {
            grid-template-columns: 1fr;
          }
        }
        @media (max-width: 680px) {
          .mcp-page {
            height: auto;
            min-height: 100dvh;
            overflow: visible;
          }
          .mcp-topbar {
            align-items: flex-start;
            flex-direction: column;
            min-height: 0;
            padding: 12px;
          }
          .mcp-actions {
            justify-content: flex-start;
            width: 100%;
          }
          .mcp-actions > * {
            flex: 1 1 auto;
          }
          .mcp-layout,
          .mcp-layout.config-expanded {
            display: flex;
            flex-direction: column;
            min-height: 0;
            overflow: visible;
            padding: 0;
          }
          .mcp-sidebar,
          .mcp-layout.config-expanded .mcp-sidebar {
            width: 100%;
            max-height: none;
            overflow: visible;
            padding: 12px;
            border-right: 0;
            border-bottom: 1px solid var(--mcp-border);
            border-radius: 0;
            box-shadow: none;
            display: flex;
            flex-direction: column;
            gap: 12px;
          }
          .mcp-sidebar .panel,
          .mcp-layout.config-expanded .mcp-sidebar .panel {
            margin: 0 !important;
            width: 100%;
            min-width: 0;
          }
          .mcp-workspace {
            width: 100%;
            padding: 12px;
            min-height: 0;
            overflow: visible;
          }
          .panel-header,
          .panel-body,
          .messages,
          .chat-input {
            padding: 12px;
          }
          .chat-session-list {
            max-height: none;
          }
          .chat-session-actions,
          .status-row {
            grid-template-columns: 1fr;
          }
          .chat-panel {
            min-height: 60dvh;
          }
          .chat-input {
            grid-template-columns: 1fr;
          }
          .chat-input textarea {
            min-height: 110px;
          }
          .primary-button,
          .secondary-button,
          .danger-button,
          .icon-action {
            min-height: 44px;
          }
          .message-wrap {
            grid-template-columns: 1fr;
          }
          .message-info-button {
            margin-top: 0;
          }
        }
      `}</style>

      <header className="mcp-topbar">
        <div className="mcp-title">
          <FaServer />
          <div>
            <h2>MCP Client</h2>
            <p>{endpointLabel} | {ollamaModel || 'No model selected'}</p>
          </div>
        </div>
        <div className="mcp-actions">
          <span className={`status-pill ${connected ? 'connected' : 'disconnected'}`}>
            {connected ? <FaCheckCircle /> : <FaExclamationTriangle />}
            {connected ? 'Connected' : 'Disconnected'}
          </span>
          <button className="icon-action" type="button" onClick={handleExportToPDF} disabled={!answers.length} title="Export chat to PDF">
            <FaFilePdf />
            PDF
          </button>
          <button className="icon-action" type="button" onClick={handleClearHistory} disabled={!answers.length} title="Clear chat history">
            <FaTrash />
            Clear
          </button>
          <button className="icon-action" type="button" onClick={() => setShowConfig((value) => !value)} title={showConfig ? 'Return to chat layout' : 'Focus configuration'}>
            <FaCog />
            {showConfig ? 'Chat' : 'Config'}
          </button>
          {connected ? (
            <button className="danger-button" type="button" onClick={handleDisconnect} disabled={connecting}>
              <FaPowerOff />
              Disconnect
            </button>
          ) : (
            <button className="primary-button" type="button" onClick={handleConnect} disabled={!canConnect}>
              <FaPlug />
              {connecting ? 'Connecting' : 'Connect'}
            </button>
          )}
        </div>
      </header>

      <main className={`mcp-layout ${showConfig ? 'config-expanded' : ''}`}>
        <aside className="mcp-sidebar">
            <section className="panel" style={{ marginBottom: 14 }}>
              <div className="panel-header">
                <span>Chats</span>
                <button className="icon-action" type="button" onClick={handleNewChat} title="New chat">
                  <FaPlus />
                </button>
              </div>
              <div className="panel-body">
                <div className="chat-session-list">
                  {chatSessions.map((chat) => (
                    <button
                      key={chat.id}
                      className={`chat-session-button ${chat.id === activeChatId ? 'active' : ''}`}
                      type="button"
                      onClick={() => handleSelectChat(chat.id)}
                      title={chat.title}
                    >
                      <span className="chat-session-title">{chat.title || 'New chat'}</span>
                      <span className="chat-session-meta">
                        {runningChatIds.includes(chat.id) ? 'Running | ' : ''}{(chat.config?.assistantName || DEFAULT_ASSISTANT_NAME)} | {(chat.config?.ollamaModel || 'No model')}
                      </span>
                    </button>
                  ))}
                </div>
                <div className="field">
                  <label htmlFor="chat-title">Chat name</label>
                  <input
                    id="chat-title"
                    value={activeChat?.title || ''}
                    onChange={(event) => handleRenameActiveChat(event.target.value)}
                    placeholder="Chat name"
                  />
                </div>
                <div className="chat-session-actions">
                  <button className="secondary-button" type="button" onClick={handleNewChat}>
                    <FaPlus />
                    New chat
                  </button>
                  <button className="danger-button" type="button" onClick={() => handleDeleteChat()} disabled={activeChatRunning || chatSessions.length === 0} title="Delete current chat">
                    <FaTrash />
                  </button>
                </div>
              </div>
            </section>

            <section className="panel">
              <div className="panel-header">
                <span>Connection</span>
                <button className="icon-action" type="button" onClick={loadStatus} disabled={loading || connecting} title="Refresh status">
                  <FaSyncAlt />
                </button>
              </div>
              <div className="panel-body">
                <div className="status-grid">
                  <div className="status-row">
                    <span>MCP package</span>
                    <strong>{status?.mcp_available ? 'Available' : 'Unknown'}</strong>
                  </div>
                  <div className="status-row">
                    <span>Ollama client</span>
                    <strong>{status?.ollama_available ? 'Available' : 'Unknown'}</strong>
                  </div>
                  <div className="status-row">
                    <span>Model source</span>
                    <strong>{modelSource}</strong>
                  </div>
                  <div className="status-row">
                    <span>Tools</span>
                    <strong>{tools.length}</strong>
                  </div>
                </div>

                <div className="field">
                  <label htmlFor="anylog-url">AnyLog MCP SSE URL</label>
                  <input
                    id="anylog-url"
                    value={anylogUrl}
                    onChange={(event) => {
                      userEditedAnylogUrlRef.current = true;
                      setAnylogUrl(event.target.value);
                    }}
                    placeholder="http://host:port/mcp/sse"
                  />
                  <div className="hint">
                    Defaults to the query node selected in the page header: {nodeMcpUrl || 'no node selected'}.
                  </div>
                </div>

                <div className="field">
                  <label htmlFor="ollama-endpoint">LLM base URL</label>
                  <input
                    id="ollama-endpoint"
                    value={ollamaEndpoint}
                    onChange={(event) => setOllamaEndpoint(event.target.value)}
                    placeholder="http://192.168.1.50:11434 or http://localhost:1234"
                  />
                  <div className="hint">Leave blank to use Ollama on the backend machine. For LM Studio, use its local server base URL, commonly http://localhost:1234.</div>
                </div>

                <div className="field">
                  <label htmlFor="llm-bearer-token">API Bearer Token</label>
                  <input
                    id="llm-bearer-token"
                    type="password"
                    value={llmBearerToken}
                    onChange={(event) => setLlmBearerToken(event.target.value)}
                    placeholder="No token"
                    autoComplete="off"
                    spellCheck="false"
                  />
                  <div className="hint">Optional. Leave blank to send no chat-specific token.</div>
                </div>

                <div className="field">
                  <label htmlFor="llm-api-type">LLM API type</label>
                  <select
                    id="llm-api-type"
                    value={llmApiType}
                    onChange={(event) => setLlmApiType(event.target.value)}
                  >
                    <option value="auto">Auto detect</option>
                    <option value="ollama">Ollama (/api/chat)</option>
                    <option value="openai">OpenAI / LM Studio (/v1/chat/completions)</option>
                  </select>
                  <div className="hint">Choose OpenAI / LM Studio for LM Studio local server. That avoids sending requests to Ollama's /api/chat endpoint.</div>
                </div>

                <div className="field">
                  <label htmlFor="request-timeout">Request timeout (seconds)</label>
                  <input
                    id="request-timeout"
                    type="number"
                    min={MIN_REQUEST_TIMEOUT_SECONDS}
                    max={MAX_REQUEST_TIMEOUT_SECONDS}
                    step="30"
                    value={requestTimeoutSeconds}
                    onChange={(event) => {
                      const value = event.target.value;
                      setRequestTimeoutSeconds(value === '' ? '' : Number(value));
                    }}
                    onBlur={() => setRequestTimeoutSeconds((value) => normalizeRequestTimeout(value))}
                  />
                  <div className="hint">
                    Applies only to this chat. Range {MIN_REQUEST_TIMEOUT_SECONDS}-{MAX_REQUEST_TIMEOUT_SECONDS} seconds; default {DEFAULT_REQUEST_TIMEOUT_SECONDS}.
                  </div>
                </div>

                <div className="field">
                  <label htmlFor="ollama-model-select">LLM model</label>
                  <div className="model-picker">
                    {modelNames.length ? (
                      <select
                        id="ollama-model-select"
                        value={selectedModelListed ? ollamaModel : ''}
                        onChange={(event) => {
                          setOllamaModel(event.target.value);
                        }}
                      >
                        <option value="" disabled>{MODEL_PLACEHOLDER}</option>
                        {modelNames.map((name) => (
                          <option key={name} value={name}>{name}</option>
                        ))}
                      </select>
                    ) : (
                      <div className="model-empty">
                        {loadingModels ? 'Loading running/loaded models...' : 'No running/loaded models found for this LLM base URL.'}
                      </div>
                    )}
                  </div>
                  <div className="hint">
                    {loadingModels
                      ? 'Loading models...'
                      : `${modelNames.length} running/loaded model(s) found for this LLM base URL. Only these models can be selected.`}
                  </div>
                </div>

                <div className="field">
                  <label htmlFor="assistant-name">Assistant name</label>
                  <input
                    id="assistant-name"
                    value={assistantName}
                    onChange={(event) => setAssistantName(event.target.value || DEFAULT_ASSISTANT_NAME)}
                    placeholder={DEFAULT_ASSISTANT_NAME}
                  />
                  <div className="hint">Purely cosmetic. Name your agent whatever makes the console feel friendlier.</div>
                </div>

                <div className="field field-wide">
                  <label htmlFor="chat-instructions">Instructions</label>
                  <textarea
                    id="chat-instructions"
                    value={instructions}
                    onChange={(event) => {
                      setInstructions(event.target.value);
                      setInstructionsSaved(false);
                    }}
                    placeholder="Add standing instructions that should be included with every request in this chat."
                    rows={5}
                  />
                  <div className="hint">These instructions are prefixed to every request sent from this chat.</div>
                  <button className="secondary-button" type="button" onClick={handleSaveInstructions}>
                    Save instructions
                  </button>
                  {instructionsSaved && <div className="hint">Instructions saved.</div>}
                </div>

                <button className="secondary-button" type="button" onClick={handleRefreshModels} disabled={loadingModels}>
                  <FaSyncAlt />
                  Refresh models
                </button>
              </div>
            </section>

            <section className="panel" style={{ marginTop: 14 }}>
              <div className="panel-header">MCP tools ({tools.length})</div>
              <div className="panel-body">
                <div className="tools-list">
                  {tools.length ? tools.map((tool, index) => (
                    <span className="tool-chip" key={`${tool.name || tool}-${index}`}>
                      {tool.name || tool}
                    </span>
                  )) : <span className="hint">No tools loaded yet.</span>}
                </div>
              </div>
            </section>
        </aside>

        <section className="mcp-workspace">
          {error && (
            <div className="error-banner">
              <FaExclamationTriangle />
              <div>{error}</div>
            </div>
          )}

          <section className="panel chat-panel">
            <div className="panel-header">
              <span>Streaming chat</span>
              <span>{activeChatRunning ? streamNote || 'Streaming response' : canSendPrompt ? 'Ready' : 'Configure MCP and model'}</span>
            </div>
            <div className="messages">
              {!answers.length ? (
                <div className="empty-state">
                  {canSendPrompt ? 'Ask a question or request a dashboard.' : 'Configure MCP and Ollama to start chatting.'}
                </div>
              ) : (
                answers.map((answer, index) => {
                  const messageId = answer.id || `message-${index}`;
                  const assistantLabel = assistantName.trim() || DEFAULT_ASSISTANT_NAME;
                  const canShowObservationControl = answer.type === 'assistant' || (answer.type === 'error' && (answer.observations || []).length > 0);
                  return (
                    <div className="message-wrap" key={messageId}>
                      {canShowObservationControl ? (
                        <button
                          type="button"
                          className={`message-info-button ${answer.showObservations ? 'active' : ''}`}
                          title={answer.showObservations ? 'Hide MCP request log' : 'Show MCP request log'}
                          aria-label={answer.showObservations ? 'Hide MCP request log' : 'Show MCP request log'}
                          onClick={() => toggleObservations(answer.id)}
                        >
                          <FaInfoCircle />
                        </button>
                      ) : <div />}
                      <article className={`message ${answer.type}`}>
                        <div className="message-header">
                          <span>{answer.type === 'user' ? 'You' : answer.type === 'error' ? 'Error' : assistantLabel}</span>
                          {answer.streaming ? (
                            <span>streaming</span>
                          ) : answer.type === 'assistant' && typeof answer.totalElapsedMs === 'number' ? (
                            <span>{formatDuration(answer.totalElapsedMs)}</span>
                          ) : null}
                        </div>
                        <div className="message-body">
                          {answer.type === 'assistant' ? (
                            <>
                              <MarkdownRenderer content={answer.content} />
                              {answer.streaming && <span className="stream-cursor" />}
                              {answer.streaming && streamNote && <div className="stream-note">{streamNote}</div>}
                              {answer.showObservations && (
                                <div ref={(node) => { observationPanelRefs.current[answer.id] = node; }}>
                                  <ObservationPanel
                                    observations={answer.observations || []}
                                    totalElapsedMs={answer.totalElapsedMs}
                                  />
                                </div>
                              )}
                              <ArtifactPanel content={answer.content} messageIndex={index} />
                            </>
                          ) : answer.type === 'error' ? (
                            <>
                              <ErrorDetails message={answer.content} exception={answer.exception} />
                              {(answer.showObservations || (answer.observations || []).length > 0) && (
                                <div ref={(node) => { observationPanelRefs.current[answer.id] = node; }}>
                                  <ObservationPanel
                                    observations={answer.observations || []}
                                    totalElapsedMs={answer.totalElapsedMs}
                                  />
                                </div>
                              )}
                            </>
                          ) : (
                            <div style={{ whiteSpace: 'pre-wrap' }}>{answer.content}</div>
                          )}

                          {answer.type === 'error' && answer.failedPrompt && (
                            <button className="secondary-button" type="button" onClick={() => handleAsk(answer.failedPrompt)} disabled={activeChatRunning}>
                              <FaSyncAlt />
                              Retry
                            </button>
                          )}
                        </div>
                      </article>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            <div className="chat-input">
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    handleAsk();
                  }
                }}
                disabled={!canSendPrompt}
                placeholder={canSendPrompt ? 'Ask AnyLog, request a dashboard, or ask for HTML/CSS/JavaScript...' : 'Configure MCP and model first...'}
              />
              {activeChatRunning ? (
                <button className="danger-button" type="button" onClick={() => handleCancel(activeChatId)}>
                  <FaStop />
                  Stop
                </button>
              ) : (
                <button className="primary-button" type="button" onClick={() => handleAsk()} disabled={!canSendPrompt || !prompt.trim()}>
                  <FaPaperPlane />
                  Send
                </button>
              )}
              <div className="hint" style={{ gridColumn: '1 / -1', marginTop: '-4px' }}>
                Return sends. Shift+Return adds a new line.
              </div>
            </div>
          </section>
        </section>
      </main>
    </div>
  );
};

export default McpclientPage;
