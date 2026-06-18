// Fully Automatic Frontend Plugin Loader
// Auto-discovers plugin pages by scanning the plugins directory

import React from 'react';
import { isPluginEnabled } from '../services/featureConfig';
import { getApiBaseUrl } from '../utils/runtimeConfig';

// Cache for plugin order/nav metadata from backend
let cachedPluginConfig = null;
let orderFetchPromise = null;

const EMPTY_PLUGIN_CONFIG = {
  plugin_order: [],
  sidebar_order: [],
  sidebar_sections: {
    above_divider: [],
    below_divider: [],
  },
  plugin_labels: {},
};

export const getOrderEntryKey = (entry) => {
  if (typeof entry === 'string') return entry;
  if (entry && typeof entry === 'object') {
    return entry.name || entry.id || entry.key || null;
  }
  return null;
};

const getOrderEntryLabel = (entry) => {
  if (entry && typeof entry === 'object') {
    return entry.label || entry.name_override || entry.title || null;
  }
  return null;
};

const normalizePluginConfig = (data = {}) => {
  const legacyPluginOrder = Array.isArray(data) ? data : data.plugin_order;
  const sidebarSections = data.sidebar_sections && typeof data.sidebar_sections === 'object'
    ? data.sidebar_sections
    : {};

  return {
    plugin_order: Array.isArray(legacyPluginOrder) ? legacyPluginOrder : [],
    sidebar_order: Array.isArray(data.sidebar_order) ? data.sidebar_order : [],
    sidebar_sections: {
      above_divider: Array.isArray(sidebarSections.above_divider)
        ? sidebarSections.above_divider
        : [],
      below_divider: Array.isArray(sidebarSections.below_divider)
        ? sidebarSections.below_divider
        : [],
    },
    plugin_labels: data.plugin_labels && typeof data.plugin_labels === 'object'
      ? data.plugin_labels
      : {},
  };
};

// Fetch plugin order from backend
const fetchPluginConfig = async () => {
  if (cachedPluginConfig !== null) {
    return cachedPluginConfig;
  }
  
  if (orderFetchPromise) {
    return orderFetchPromise;
  }
  
  orderFetchPromise = (async () => {
    try {
      const API_URL = getApiBaseUrl();
      const response = await fetch(`${API_URL}/plugins/order`);
      if (response.ok) {
        const data = await response.json();
        cachedPluginConfig = normalizePluginConfig(data);
        return cachedPluginConfig;
      }
    } catch (error) {
      console.warn('Failed to fetch plugin order:', error);
    }
    cachedPluginConfig = EMPTY_PLUGIN_CONFIG;
    return cachedPluginConfig;
  })();

  return orderFetchPromise;
};

// Sort plugins according to order config
const sortPluginsByOrder = (plugins, order) => {
  if (!order || order.length === 0) {
    return Object.keys(plugins).sort().map(key => ({ key, plugin: plugins[key] }));
  }

  const ordered = [];
  const remaining = new Set(Object.keys(plugins));

  for (const entry of order) {
    const pluginName = getOrderEntryKey(entry);
    if (plugins[pluginName]) {
      ordered.push({ key: pluginName, plugin: plugins[pluginName] });
      remaining.delete(pluginName);
    }
  }

  const remainingSorted = Array.from(remaining).sort();
  for (const pluginName of remainingSorted) {
    ordered.push({ key: pluginName, plugin: plugins[pluginName] });
  }

  return ordered;
};

// Auto-discover plugin pages using Vite's import.meta.glob
// Uses eager loading so modules are already available — no dynamic re-import needed
export const discoverPluginPages = () => {
  const pluginPages = {};

  const modules = import.meta.glob('./*/**Page.js', { eager: true });

  Object.entries(modules).forEach(([modulePath, module]) => {
    try {
      const pathParts = modulePath.split('/');
      const pluginName = pathParts[1];

      if (pluginPages[pluginName]) return;

      const metadata = module.pluginMetadata || {};
      const PageComponent = module.default;

      if (!PageComponent) {
        console.warn(`Plugin ${pluginName} has no default export, skipping.`);
        return;
      }

      pluginPages[pluginName] = {
        component: PageComponent,
        path: pluginName,
        name: metadata.name || formatPluginName(pluginName),
        icon: metadata.icon || null
      };
    } catch (error) {
      console.warn(`Failed to load plugin from ${modulePath}:`, error);
    }
  });

  return pluginPages;
};

// Helper function to format plugin name (fallback if metadata not provided)
const formatPluginName = (pluginName) => {
  const words = pluginName
    .replace(/([A-Z])/g, ' $1')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/\s+/)
    .filter(word => word.length > 0);

  return words
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

const applyPluginConfig = (pages) => {
  const config = cachedPluginConfig || EMPTY_PLUGIN_CONFIG;
  const configuredLabels = { ...config.plugin_labels };

  [
    ...config.plugin_order,
    ...config.sidebar_order,
    ...config.sidebar_sections.above_divider,
    ...config.sidebar_sections.below_divider,
  ].forEach((entry) => {
    const key = getOrderEntryKey(entry);
    const label = getOrderEntryLabel(entry);
    if (key && label) configuredLabels[key] = label;
  });

  return Object.fromEntries(
    Object.entries(pages).map(([key, plugin]) => ([
      key,
      {
        ...plugin,
        name: configuredLabels[key] || plugin.name,
      },
    ])),
  );
};

// Get plugin pages for routing (sorted by plugin order)
export const getPluginPages = () => {
  const pages = applyPluginConfig(discoverPluginPages());
  const order = (cachedPluginConfig || EMPTY_PLUGIN_CONFIG).plugin_order;
  const sortedPlugins = sortPluginsByOrder(pages, order);

  if (cachedPluginConfig === null && !orderFetchPromise) {
    fetchPluginConfig();
  }

  const sortedPages = {};
  for (const { key, plugin } of sortedPlugins) {
    sortedPages[key] = plugin;
  }

  return sortedPages;
};

// Get plugin pages filtered by feature config (async)
export const getPluginPagesFiltered = async () => {
  const pages = applyPluginConfig(discoverPluginPages());
  const order = (cachedPluginConfig || EMPTY_PLUGIN_CONFIG).plugin_order;
  const sortedPlugins = sortPluginsByOrder(pages, order);

  if (cachedPluginConfig === null && !orderFetchPromise) {
    fetchPluginConfig();
  }

  const filteredPlugins = [];
  for (const { key, plugin } of sortedPlugins) {
    if (await isPluginEnabled(key)) {
      filteredPlugins.push({ key, plugin });
    }
  }

  const filteredPages = {};
  for (const { key, plugin } of filteredPlugins) {
    filteredPages[key] = plugin;
  }

  return filteredPages;
};

// Get plugin sidebar items (sorted by plugin order)
export const getPluginSidebarItems = () => {
  const pages = applyPluginConfig(discoverPluginPages());
  const order = (cachedPluginConfig || EMPTY_PLUGIN_CONFIG).plugin_order;
  const sortedPlugins = sortPluginsByOrder(pages, order);

  if (cachedPluginConfig === null && !orderFetchPromise) {
    fetchPluginConfig();
  }

  return sortedPlugins.map(({ plugin }) => ({
    path: plugin.path,
    name: plugin.name,
    icon: plugin.icon
  }));
};

// Get plugin sidebar items filtered by feature config (async)
export const getPluginSidebarItemsFiltered = async () => {
  const pages = applyPluginConfig(discoverPluginPages());
  const order = (cachedPluginConfig || EMPTY_PLUGIN_CONFIG).plugin_order;
  const sortedPlugins = sortPluginsByOrder(pages, order);

  if (cachedPluginConfig === null && !orderFetchPromise) {
    fetchPluginConfig();
  }

  const filteredItems = [];
  for (const { plugin } of sortedPlugins) {
    if (await isPluginEnabled(plugin.path)) {
      filteredItems.push({
        path: plugin.path,
        name: plugin.name,
        icon: plugin.icon
      });
    }
  }

  return filteredItems;
};

// Initialize plugin order fetch (call this early to preload the order)
export const initializePluginOrder = () => {
  const result = fetchPluginConfig();
  return Promise.resolve(result);
};

export const getSidebarOrder = () => (
  (cachedPluginConfig || EMPTY_PLUGIN_CONFIG).sidebar_order
);

export const getSidebarSections = () => (
  (cachedPluginConfig || EMPTY_PLUGIN_CONFIG).sidebar_sections
);
