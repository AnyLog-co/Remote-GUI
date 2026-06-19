// src/components/TopBar.js
import React, { useEffect, useState } from 'react';
import '../styles/TopBar.css';
import logo from '../assets/AnyLog_EDM_logo.png';
import NodePicker from './NodePicker.js';
import { NavLink } from 'react-router-dom';
import { getLicenseInfo } from '../services/api';


const TopBar = ({ nodes, selectedNode, onAddNode, onRemoveNode, onEditNode, onSelectNode, restoredFromStorage, onClearStoredData }) => {
  const [license, setLicense] = useState(null);

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

  return (
    <header className="topbar">
      <div className="topbar-left">
        <img src={logo} alt="App Logo" className="logo" />
        <NodePicker 
          nodes={nodes} 
          selectedNode={selectedNode} 
          onAddNode={onAddNode} 
          onRemoveNode={onRemoveNode}
          onEditNode={onEditNode}
          onSelectNode={onSelectNode} 
        />
      </div>
      <div className="topbar-center">
        <NavLink to="about" className="topbar-license-btn">
          Licensee: {license?.company ?? '—'}
        </NavLink>
      </div>
      <div className="topbar-right">
        {restoredFromStorage && (
          <div className="restoration-message">
            <span className="restoration-icon">🔄</span>
            <span className="restoration-text">Data restored from previous session</span>
          </div>
        )}
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
    </header>
  );
};


export default TopBar;
