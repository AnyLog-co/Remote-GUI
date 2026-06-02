const DEFAULT_API_PORT = '8080';

function trimTrailingSlash(value) {
  return typeof value === 'string' ? value.replace(/\/+$/, '') : value;
}

function isLoopbackHost(host) {
  const normalized = String(host || '').toLowerCase();
  return (
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized === '[::1]'
  );
}

function getUrlHost(value) {
  try {
    return new URL(value, window.location.href).hostname;
  } catch (_) {
    return '';
  }
}

export function getApiBaseUrl() {
  const runtimeUrl = window._env_?.VITE_API_URL;
  const buildUrl = import.meta.env?.VITE_API_URL;
  const configuredUrl = runtimeUrl || buildUrl;
  const browserHost = window.location.hostname;

  if (configuredUrl) {
    const configuredHost = getUrlHost(configuredUrl);
    const remoteBrowserNeedsHostRelativeApi =
      isLoopbackHost(configuredHost) && !isLoopbackHost(browserHost);

    if (!remoteBrowserNeedsHostRelativeApi) {
      return trimTrailingSlash(configuredUrl);
    }
  }

  const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
  const backendPort = window._env_?.REMOTE_GUI_BE || DEFAULT_API_PORT;
  return `${protocol}//${browserHost}:${backendPort}`;
}
