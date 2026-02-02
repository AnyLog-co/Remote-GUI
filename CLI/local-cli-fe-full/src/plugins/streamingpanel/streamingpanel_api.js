// Streaming Panel Plugin API
// Fetches available stream URLs (dummy until command exists)

const API_URL = window._env_?.REACT_APP_API_URL || "http://localhost:8000";

/**
 * URL for the scaling player iframe. Pass width/height (from probe) so panel ratio matches stream = no black bars.
 */
export const getPlayerIframeUrl = (streamUrl, width, height) => {
  if (!streamUrl) return "";
  let u = `${API_URL}/streamingpanel/player?url=${encodeURIComponent(streamUrl)}`;
  if (width != null && height != null && width > 0 && height > 0) {
    u += `&w=${encodeURIComponent(width)}&h=${encodeURIComponent(height)}`;
  }
  return u;
};

/**
 * Get list of available streams (url + label) for dropdown.
 * Backend uses dummy data until the real command exists.
 */
export const getStreams = async () => {
  try {
    const response = await fetch(`${API_URL}/streamingpanel/streams`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error("Error fetching stream options:", error);
    throw error;
  }
};

/**
 * Get plugin info
 */
export const getStreamingPanelInfo = async () => {
  try {
    const response = await fetch(`${API_URL}/streamingpanel/`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error("Error fetching streaming panel info:", error);
    throw error;
  }
};
