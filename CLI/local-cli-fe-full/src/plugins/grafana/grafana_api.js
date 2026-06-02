// Grafana Plugin API
// Simple API client for Grafana plugin

import { getApiBaseUrl } from '../../utils/runtimeConfig';

const API_URL = getApiBaseUrl();

/**
 * Get Grafana information
 */
export const getGrafanaInfo = async () => {
  try {
    const response = await fetch(`${API_URL}/grafana/`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Error fetching Grafana info:', error);
    throw error;
  }
};

/**
 * Get Grafana URL
 */
export const getGrafanaUrl = async () => {
  try {
    const response = await fetch(`${API_URL}/grafana/url`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    return data.url;
  } catch (error) {
    console.error('Error fetching Grafana URL:', error);
    throw error;
  }
};
