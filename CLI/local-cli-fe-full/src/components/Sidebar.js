// src/components/Sidebar.js
import React, { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import {
  getOrderEntryKey,
  getPluginSidebarItems,
  getSidebarOrder,
  getSidebarSections,
  initializePluginOrder,
} from '../plugins/loader';
import { 
  initializeFeatureConfig, 
  isFeatureEnabled, 
  isPluginEnabled 
} from '../services/featureConfig';
import { getVersion } from '../services/api';
import '../styles/Sidebar.css';

const formatVersion = (version) => {
  if (!version || version === '—') return 'v—';
  const cleanVersion = String(version).trim().replace(/^v/i, '').split(/\s|\(/)[0];
  return `v${cleanVersion}`;
};

const Sidebar = ({ isOpen = false, onNavigate }) => {
  const [pluginItems, setPluginItems] = useState(() => getPluginSidebarItems());
  const [enabledFeatures, setEnabledFeatures] = useState(new Set());
  const [enabledPlugins, setEnabledPlugins] = useState(new Set());
  const [remoteGuiVersion, setRemoteGuiVersion] = useState(null);
  
  // Feature configuration mapping
  const featureConfig = [
    { path: 'client', name: 'Client', featureKey: 'client' },
    { path: 'monitor', name: 'Monitor', featureKey: 'monitor' },
    { path: 'policies', name: 'Policies', featureKey: 'policies' },
    { path: 'adddata', name: 'Add Data', featureKey: 'adddata' },
    { path: 'viewfiles', name: 'View Files', featureKey: 'viewfiles' },
    { path: 'sqlquery', name: 'SQL Query', featureKey: 'sqlquery' },
    { path: 'blockchain', name: 'Blockchain Manager', featureKey: 'blockchain' },
    { path: 'presets', name: 'Presets', featureKey: 'presets' },
    { path: 'bookmarks', name: 'Bookmarks', featureKey: 'bookmarks' },
    { path: 'security', name: 'Security (Anylog)', featureKey: 'security' },
  ];
  
  // Fetch feature config and plugin order on mount
  useEffect(() => {
    const loadConfig = async () => {
      // Initialize both configs in parallel
      await Promise.all([
        initializeFeatureConfig(),
        initializePluginOrder()
      ]);
      
      // Check which features are enabled
      const enabled = new Set();
      for (const feature of featureConfig) {
        if (await isFeatureEnabled(feature.featureKey)) {
          enabled.add(feature.featureKey);
        }
      }
      setEnabledFeatures(enabled);
      
      // Check which plugins are enabled and filter plugin items
      const allPluginItems = getPluginSidebarItems();
      const enabledPluginItems = [];
      const enabledPluginSet = new Set();
      
      for (const plugin of allPluginItems) {
        if (await isPluginEnabled(plugin.path)) {
          enabledPluginItems.push(plugin);
          enabledPluginSet.add(plugin.path);
        }
      }
      
      setEnabledPlugins(enabledPluginSet);
      setPluginItems(enabledPluginItems);
    };
    
    loadConfig();
  }, []);

  useEffect(() => {
    let isCurrent = true;
    getVersion().then((versionInfo) => {
      if (!isCurrent) return;
      setRemoteGuiVersion(versionInfo?.remote_gui_version ?? versionInfo?.version ?? null);
    });

    return () => {
      isCurrent = false;
    };
  }, []);
  
  // Filter features based on config
  const visibleFeatures = featureConfig.filter(feature => 
    enabledFeatures.has(feature.featureKey)
  );
  
  // Filter plugins based on config
  const visiblePlugins = pluginItems.filter(plugin => 
    enabledPlugins.has(plugin.path)
  );

  const navItemsByPath = new Map();
  visibleFeatures.forEach((feature) => {
    navItemsByPath.set(feature.path, {
      ...feature,
      type: 'feature',
    });
  });
  visiblePlugins.forEach((plugin) => {
    navItemsByPath.set(plugin.path, {
      ...plugin,
      type: 'plugin',
    });
  });

  const takeOrderedItems = (entries, remainingPaths) => {
    const items = [];
    entries.forEach((entry) => {
      const path = getOrderEntryKey(entry);
      if (!path || !navItemsByPath.has(path) || !remainingPaths.has(path)) return;
      items.push(navItemsByPath.get(path));
      remainingPaths.delete(path);
    });
    return items;
  };

  const sidebarSections = getSidebarSections();
  const hasSidebarSections = (
    sidebarSections.above_divider.length > 0 ||
    sidebarSections.below_divider.length > 0
  );
  const remainingPaths = new Set(navItemsByPath.keys());

  const topNavItems = hasSidebarSections
    ? takeOrderedItems(sidebarSections.above_divider, remainingPaths)
    : takeOrderedItems(getSidebarOrder(), remainingPaths);
  const bottomNavItems = hasSidebarSections
    ? takeOrderedItems(sidebarSections.below_divider, remainingPaths)
    : [];

  Array.from(remainingPaths)
    .map((path) => navItemsByPath.get(path))
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((item) => {
      bottomNavItems.push(item);
    });

  const renderNavItem = (item) => (
    <NavLink
      key={item.path}
      to={item.path}
      className={({ isActive }) => isActive ? 'active' : ''}
      onClick={onNavigate}
    >
      {item.icon && `${item.icon} `}{item.name}
    </NavLink>
  );
  
  return (
    <nav
      id="dashboard-navigation"
      className={`sidebar${isOpen ? ' open' : ''}`}
      aria-label="Main navigation"
    >
      {topNavItems.map(renderNavItem)}
      {hasSidebarSections && topNavItems.length > 0 && bottomNavItems.length > 0 && (
        <div className="sidebar-divider" role="separator" />
      )}
      {bottomNavItems.map(renderNavItem)}

      <div className="sidebar-version">
        <NavLink to="about" className="sidebar-about-link" onClick={onNavigate}>About</NavLink>
        <a href="https://anylog-co.github.io/anylog-docs.github.io/docs/readme/"
          className="sidebar-about-link"
          onClick={onNavigate}
          target="_blank"
          rel="noopener noreferrer"
        >
          Documentation
        </a>
        <span className="sidebar-version-number">
            {formatVersion(remoteGuiVersion)}
        </span>
      </div>
    </nav>
  );
};

export default Sidebar;
