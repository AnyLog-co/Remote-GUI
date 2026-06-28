// src/components/TopBar.js
import React, { useEffect, useState } from 'react';
import '../styles/TopBar.css';
import logo from '../assets/AnyLog_EDM_logo.png';
import NodePicker from './NodePicker.js';
import { NavLink } from 'react-router-dom';
import { checkNodeReachable, getLicenseInfo } from '../services/api';


const TopBar = ({
  nodes,
  selectedNode,
  onAddNode,
  onRemoveNode,
  onEditNode,
  onSelectNode,
  restoredFromStorage,
  onClearStoredData,
  isNavigationOpen = false,
  onNavigationToggle,
}) => {
  const [license, setLicense] = useState(null);
  const [areMobileToolsOpen, setAreMobileToolsOpen] = useState(false);
  const [nodeReachability, setNodeReachability] = useState({
    checking: false,
    networkDisconnected: false,
  });

  useEffect(() => {
    let isCurrent = true;
    if (!selectedNode) {
      setLicense(null);
      return () => {
        isCurrent = false;
      };
    }

    getLicenseInfo({ connectInfo: selectedNode }).then((licenseInfo) => {
      if (isCurrent) {
        setLicense(licenseInfo);
      }
    });

    return () => {
      isCurrent = false;
    };
  }, [selectedNode]);

  useEffect(() => {
    if (!selectedNode) {
      setNodeReachability({ checking: false, networkDisconnected: false });
      return undefined;
    }

    const controller = new AbortController();
    setNodeReachability({ checking: true, networkDisconnected: false });

    checkNodeReachable(selectedNode, { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return;
      setNodeReachability({
        checking: false,
        networkDisconnected: !result.ok,
      });
    });

    return () => {
      controller.abort();
    };
  }, [selectedNode]);

  return (
    <header className="topbar">
      <button
        className="navigation-toggle"
        type="button"
        aria-label={isNavigationOpen ? 'Close navigation' : 'Open navigation'}
        aria-controls="dashboard-navigation"
        aria-expanded={isNavigationOpen}
        onClick={onNavigationToggle}
      >
        <span aria-hidden="true">{isNavigationOpen ? '✕' : '☰'}</span>
      </button>
      <div className="topbar-left">
        <img src={logo} alt="App Logo" className="logo" />
        <NavLink to="about" className="topbar-license-btn">
          Licensed to: {license?.company ?? '—'}
        </NavLink>
        <NodePicker 
          nodes={nodes} 
          selectedNode={selectedNode} 
          networkDisconnected={nodeReachability.networkDisconnected}
          onAddNode={onAddNode} 
          onRemoveNode={onRemoveNode}
          onEditNode={onEditNode}
          onSelectNode={onSelectNode} 
        />
      </div>
      <button
        className="mobile-tools-toggle"
        type="button"
        aria-label={areMobileToolsOpen ? 'Close header options' : 'Open header options'}
        aria-expanded={areMobileToolsOpen}
        onClick={() => setAreMobileToolsOpen((isOpen) => !isOpen)}
      >
        <span aria-hidden="true">•••</span>
      </button>
      <div className={`topbar-right${areMobileToolsOpen ? ' mobile-open' : ''}`}>
        <NavLink to="about" className="mobile-license-link">
          Licensed to: {license?.company ?? '—'}
        </NavLink>
        <NavLink to="bookmarks" className="mobile-header-link">
          Update Bookmarks
        </NavLink>
        {onClearStoredData && (
          <button 
            onClick={onClearStoredData}
            className="clear-data-btn"
            title="Clear all stored data"
          >
            🗑️ Clear Browser Data
          </button>
        )}
        {/* <button className="profile-btn">User Profile</button> */}
        {/* <nav className="profile-btn">
              <NavLink to="userprofile" className={({ isActive }) => isActive ? 'active' : ''}>User Profile</NavLink>
        </nav> */}
      </div>
      {restoredFromStorage && (
        <div className="restoration-message" role="status">
          <span className="restoration-icon">🔄</span>
          <span className="restoration-text">Data restored from previous session</span>
        </div>
      )}
    </header>
  );
};


export default TopBar;
