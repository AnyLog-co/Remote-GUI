import React, { useState, useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import TopBar from '../components/TopBar';
import Client from './Client';
import Monitor from './Monitor';
import Policies from './Policies';
import AddData from './AddData';
import UserProfile from './UserProfile';
import ViewFiles from './ViewFiles';
import Presets from './Presets';
import Bookmarks from './Bookmarks';
import SqlQueryGenerator from './SqlQueryGenerator';
import BlockchainManager from './BlockchainManager';
import About from './About';

// Import plugin loader
import { getPluginPages } from '../plugins/loader';
// Import feature config
import {
  initializeFeatureConfig,
  isFeatureEnabled,
  isPluginEnabled,
} from '../services/featureConfig';

import PolicyGeneratorPage from './Security';
// import Presets from './Presets';
import '../styles/Dashboard.css'; // dashboard-specific styles
import { bookmarkNode, getBookmarks, setDefaultBookmark } from '../services/file_auth';

const DEFAULT_BOOKMARK_PORT = '32149';

function getBrowserDefaultNode() {
  const host = window.location.hostname;
  if (!host || host === '0.0.0.0') {
    return null;
  }
  return `${host}:${DEFAULT_BOOKMARK_PORT}`;
}

function uniqueNodes(nodeList) {
  if (!Array.isArray(nodeList)) {
    return [];
  }

  return [...new Set(nodeList.filter(Boolean))];
}

const Dashboard = () => {
  // Load plugin pages
  const pluginPages = getPluginPages();

  // Feature configuration state
  const [enabledFeatures, setEnabledFeatures] = useState(new Set());
  const [enabledPlugins, setEnabledPlugins] = useState(new Set());
  const [configLoaded, setConfigLoaded] = useState(false);

  // Load initial state from localStorage
  const [nodes, setNodes] = useState(() => {
    const savedNodes = localStorage.getItem('dashboard-nodes');
    if (!savedNodes) {
      return [];
    }

    try {
      return uniqueNodes(JSON.parse(savedNodes));
    } catch (error) {
      console.warn('Failed to parse saved dashboard nodes:', error);
      return [];
    }
  });

  const [selectedNode, setSelectedNode] = useState(() => {
    const savedSelectedNode = localStorage.getItem('dashboard-selected-node');
    return savedSelectedNode || null;
  });

  const [restoredFromStorage, setRestoredFromStorage] = useState(false);

  // Feature configuration mapping
  const featureRoutes = [
    { path: 'client', component: Client, featureKey: 'client' },
    { path: 'monitor', component: Monitor, featureKey: 'monitor' },
    { path: 'policies', component: Policies, featureKey: 'policies' },
    { path: 'adddata', component: AddData, featureKey: 'adddata' },
    { path: 'viewfiles', component: ViewFiles, featureKey: 'viewfiles' },
    { path: 'sqlquery', component: SqlQueryGenerator, featureKey: 'sqlquery' },
    {
      path: 'blockchain',
      component: BlockchainManager,
      featureKey: 'blockchain',
    },
    { path: 'presets', component: Presets, featureKey: 'presets' },
    { path: 'bookmarks', component: Bookmarks, featureKey: 'bookmarks' },
    {
      path: 'security',
      component: PolicyGeneratorPage,
      featureKey: 'security',
    },
  ];

  // Load feature configuration on mount
  useEffect(() => {
    const loadConfig = async () => {
      await initializeFeatureConfig();

      // Check which features are enabled
      const enabled = new Set();
      for (const feature of featureRoutes) {
        if (await isFeatureEnabled(feature.featureKey)) {
          enabled.add(feature.featureKey);
        }
      }
      setEnabledFeatures(enabled);

      // Check which plugins are enabled
      const enabledPluginSet = new Set();
      for (const [pluginName] of Object.entries(pluginPages)) {
        if (await isPluginEnabled(pluginName)) {
          enabledPluginSet.add(pluginName);
        }
      }
      setEnabledPlugins(enabledPluginSet);
      setConfigLoaded(true);
    };

    loadConfig();
  }, []);

  // Debug logging
  console.log('Dashboard - selectedNode:', selectedNode);
  console.log('Dashboard - nodes:', nodes);
  console.log(
    'Dashboard - localStorage nodes:',
    localStorage.getItem('dashboard-nodes'),
  );
  console.log(
    'Dashboard - localStorage selectedNode:',
    localStorage.getItem('dashboard-selected-node'),
  );

  // Save nodes to localStorage whenever they change
  useEffect(() => {
    const dedupedNodes = uniqueNodes(nodes);
    if (dedupedNodes.length !== nodes.length) {
      setNodes(dedupedNodes);
      return;
    }

    localStorage.setItem('dashboard-nodes', JSON.stringify(dedupedNodes));
  }, [nodes]);

  // Save selectedNode to localStorage whenever it changes
  useEffect(() => {
    if (selectedNode) {
      localStorage.setItem('dashboard-selected-node', selectedNode);
      console.log('Saved selectedNode to localStorage:', selectedNode);
    } else {
      localStorage.removeItem('dashboard-selected-node');
      console.log('Removed selectedNode from localStorage');
    }
  }, [selectedNode]);

  // Ensure selectedNode is in nodes list if it exists
  useEffect(() => {
    if (selectedNode && !nodes.includes(selectedNode)) {
      console.log('Selected node not in nodes list, adding it:', selectedNode);
      setNodes((prevNodes) => (
        prevNodes.includes(selectedNode) ? prevNodes : [...prevNodes, selectedNode]
      ));
    }
  }, [selectedNode, nodes]);

  // Show restoration message if data was loaded from localStorage
  useEffect(() => {
    const hasStoredData =
      localStorage.getItem('dashboard-nodes') ||
      localStorage.getItem('dashboard-selected-node');
    if (hasStoredData) {
      setRestoredFromStorage(true);
      // Auto-hide the message after 3 seconds
      const timer = setTimeout(() => {
        setRestoredFromStorage(false);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, []);

  // On first load, if no selected node, use default bookmark if present
  useEffect(() => {
    (async () => {
      try {
        if (!selectedNode) {
          const res = await getBookmarks();
          const list = Array.isArray(res.data) ? res.data : [];
          const def = list.find((b) => b.is_default);
          if (def && def.node) {
            setSelectedNode(def.node);
            setNodes((prev) => (
              prev.includes(def.node) ? prev : [...prev, def.node]
            ));
          } else if (list.length === 0) {
            const browserDefaultNode = getBrowserDefaultNode();
            if (browserDefaultNode) {
              await bookmarkNode({ node: browserDefaultNode });
              await setDefaultBookmark({ node: browserDefaultNode });
              setSelectedNode(browserDefaultNode);
              setNodes((prev) => (
                prev.includes(browserDefaultNode) ? prev : [...prev, browserDefaultNode]
              ));
            }
          }
        }
      } catch (e) {
        // ignore failures silently
      }
    })();
    // run only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Utility function to clear all stored data
  const clearStoredData = () => {
    localStorage.removeItem('dashboard-nodes');
    localStorage.removeItem('dashboard-selected-node');
    [
      'mcpclient_chat_history',
      'mcpclient_config',
      'mcpclient_chats_v2',
      'mcpclient_active_chat_id',
    ].forEach((key) => localStorage.removeItem(key));
    window.dispatchEvent(new Event('mcpclient-storage-cleared'));
    setNodes([]);
    setSelectedNode(null);
    console.log('Cleared all stored dashboard data');
  };

  // Adds a new node (if valid and not already in the list)
  const handleAddNode = (newNode) => {
    if (!newNode) {
      return;
    }

    setNodes((prevNodes) => (
      prevNodes.includes(newNode) ? prevNodes : [...prevNodes, newNode]
    ));
  };

  const handleRemoveNode = (nodeToRemove) => {
    setNodes((prev) => prev.filter((n) => n !== nodeToRemove));
    if (selectedNode === nodeToRemove) {
      const remaining = nodes.filter((n) => n !== nodeToRemove);
      setSelectedNode(remaining.length > 0 ? remaining[0] : null);
    }
  };

  const handleEditNode = (oldNode, newNode) => {
    setNodes((prev) => prev.map((n) => (n === oldNode ? newNode : n)));
    if (selectedNode === oldNode) {
      setSelectedNode(newNode);
    }
  };

  return (
    <div className="dashboard-container">
      <TopBar
        nodes={nodes}
        selectedNode={selectedNode}
        onAddNode={handleAddNode}
        onRemoveNode={handleRemoveNode}
        onEditNode={handleEditNode}
        onSelectNode={setSelectedNode}
        restoredFromStorage={restoredFromStorage}
        onClearStoredData={clearStoredData}
      />
      <div className="dashboard-content">
        <Sidebar selectedNode={selectedNode} />
        <div className="dashboard-main">
          <Routes>
            {/* Core Feature Routes - Filtered by feature config */}
            {featureRoutes
              .filter((route) => enabledFeatures.has(route.featureKey))
              .map((route) => {
                if (route.path === 'bookmarks') {
                  return (
                    <Route
                      key={route.path}
                      path={route.path}
                      element={
                        <route.component
                          node={selectedNode}
                          onSelectNode={(node) => {
                            console.log('Selecting node from bookmarks:', node);
                            // Add node to nodes list if not already present
                            if (node && !nodes.includes(node)) {
                              console.log('Adding new node to list:', node);
                              setNodes((prevNodes) => [...prevNodes, node]);
                            }
                            // Set as selected node
                            setSelectedNode(node);
                            console.log('Selected node set to:', node);
                          }}
                        />
                      }
                    />
                  );
                }
                return (
                  <Route
                    key={route.path}
                    path={route.path}
                    element={<route.component node={selectedNode} />}
                  />
                );
              })}

            {/* User Profile - Always available */}
            <Route
              path="userprofile"
              element={<UserProfile node={selectedNode} />}
            />

            {/* About - Always available, key forces reload when node changes */}
            <Route
              path="about"
              element={
                <About
                  key={
                    selectedNode
                      ? typeof selectedNode === 'string'
                        ? selectedNode
                        : JSON.stringify(selectedNode)
                      : 'no-node'
                  }
                  node={selectedNode}
                />
              }
            />

            {/* Plugin Routes - Auto-loaded and filtered by feature config */}
            {configLoaded &&
              Object.entries(pluginPages)
                .filter(([pluginName]) => enabledPlugins.has(pluginName))
                .map(([key, plugin]) => (
                  <Route
                    key={key}
                    path={plugin.path}
                    element={
                      <React.Suspense
                        fallback={<div>Loading {plugin.name}...</div>}
                      >
                        <plugin.component node={selectedNode} />
                      </React.Suspense>
                    }
                  />
                ))}

            {/* Default view - Use first enabled feature or Client */}
            
            <Route
              path="*"
              element={(() => {
                if (enabledFeatures.has('client')) {
                  return <Client node={selectedNode} />;
                }
                const firstEnabled = featureRoutes.find((r) =>
                  enabledFeatures.has(r.featureKey),
                );
                if (firstEnabled) {
                  const Component = firstEnabled.component;
                  return <Component node={selectedNode} />;
                }
                return (
                  <div>
                    No features enabled. Please check feature configuration.
                  </div>
                );
              })()}
            />
          </Routes>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
