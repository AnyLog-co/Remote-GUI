// Fully Automatic Frontend Plugin Loader
// Auto-discovers plugin pages by scanning the plugins directory

import React from 'react';
import { isPluginEnabled } from '../services/featureConfig';

// Cache for plugin order from backend
let cachedPluginOrder = null;
let orderFetchPromise = null;

// Fetch plugin order from backend
const fetchPluginOrder = async () => {
  if (cachedPluginOrder !== null) {
    return cachedPluginOrder;
  }
  
  if (orderFetchPromise) {
    return orderFetchPromise;
  }
  
  orderFetchPromise = (async () => {
    try {
      const API_URL = window._env_?.VITE_API_URL || import.meta.env.VITE_API_URL || "http://localhost:8080";
      const response = await fetch(`${API_URL}/plugins/order`);
      if (response.ok) {
        const data = await response.json();
        cachedPluginOrder = data.plugin_order || [];
        return cachedPluginOrder;
      }
    } catch (error) {
      console.warn('Failed to fetch plugin order:', error);
    }
    cachedPluginOrder = [];
    return cachedPluginOrder;
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

  for (const pluginName of order) {
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

// Get plugin pages for routing (sorted by plugin order)
export const getPluginPages = () => {
  const pages = discoverPluginPages();
  const order = cachedPluginOrder || [];
  const sortedPlugins = sortPluginsByOrder(pages, order);

  if (cachedPluginOrder === null && !orderFetchPromise) {
    fetchPluginOrder();
  }

  const sortedPages = {};
  for (const { key, plugin } of sortedPlugins) {
    sortedPages[key] = plugin;
  }

  return sortedPages;
};

// Get plugin pages filtered by feature config (async)
export const getPluginPagesFiltered = async () => {
  const pages = discoverPluginPages();
  const order = cachedPluginOrder || [];
  const sortedPlugins = sortPluginsByOrder(pages, order);

  if (cachedPluginOrder === null && !orderFetchPromise) {
    fetchPluginOrder();
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
  const pages = discoverPluginPages();
  const order = cachedPluginOrder || [];
  const sortedPlugins = sortPluginsByOrder(pages, order);

  if (cachedPluginOrder === null && !orderFetchPromise) {
    fetchPluginOrder();
  }

  return sortedPlugins.map(({ plugin }) => ({
    path: plugin.path,
    name: plugin.name,
    icon: plugin.icon
  }));
};

// Get plugin sidebar items filtered by feature config (async)
export const getPluginSidebarItemsFiltered = async () => {
  const pages = discoverPluginPages();
  const order = cachedPluginOrder || [];
  const sortedPlugins = sortPluginsByOrder(pages, order);

  if (cachedPluginOrder === null && !orderFetchPromise) {
    fetchPluginOrder();
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
  const result = fetchPluginOrder();
  return Promise.resolve(result);
};