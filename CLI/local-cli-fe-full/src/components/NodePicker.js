// src/components/NodePicker.js
import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { getConnectedNodes, checkNodeReachable } from '../services/api';
import '../styles/NodePicker.css';
import { useEffect } from 'react';
import { validateNodeConnection } from '../utils/connectionAddress';

const NodePicker = ({ nodes, selectedNode, onAddNode, onRemoveNode, onEditNode, onSelectNode }) => {
  const navigate = useNavigate();
  const [newNode, setNewNode] = useState('');
  const [connectionError, setConnectionError] = useState(null);
  const [connectWarning, setConnectWarning] = useState(null);
  const [error, setError] = useState(null);
  const [local, setLocal] = useState(false);
  const [showAddNode, setShowAddNode] = useState(false);
  const [checking, setChecking] = useState(false);
  const [editingNode, setEditingNode] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [editError, setEditError] = useState(null);
  const abortRef = useRef(null);

  useEffect(() => {
    if (!connectWarning) return;
    const timer = setTimeout(() => setConnectWarning(null), 15000);
    return () => clearTimeout(timer);
  }, [connectWarning]);

  const dismissWarning = () => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setChecking(false);
    setConnectWarning(null);
  };

  const handleAdd = async () => {
    const check = validateNodeConnection(newNode);
    if (!check.ok) {
      setConnectionError(check.message);
      return;
    }
    setConnectionError(null);
    setConnectWarning(null);

    try {
      await onAddNode(check.value);
    } catch (err) {
      console.error('Failed to add node:', err);
      setConnectionError(err.message || 'Failed to add node.');
      return;
    }
    onSelectNode(check.value);
    setNewNode('');
    setShowAddNode(false);

    // Fire reachability check in the background — never blocks the UI
    const controller = new AbortController();
    abortRef.current = controller;
    setChecking(true);

    checkNodeReachable(check.value, { signal: controller.signal }).then((result) => {
      abortRef.current = null;
      setChecking(false);
      if (!result.ok) {
        setConnectWarning(
          result.message || `Unable to confirm connectivity to ${check.value}.`
        );
      }
    });
  };

  const handleAddConnectedNodes = async (e) => {
    e.preventDefault();
    setError(null);

    try {
      console.log("Selected Node is this:", selectedNode);
      const fetchedNodes = await getConnectedNodes({ selectedNode });
      for (const node of fetchedNodes.data) {
        console.log(node);
        await onAddNode(node);
      }

    } catch (err) {
      setError("Failed to test network.");
    }
  };

  const makeLocal = (node, isLocal) => {
    if (!node) return node;  // Return if node is empty
    const parts = node.split(':');
    if (isLocal && parts.length === 2) {  // Check if local is true and node is in "ip:port" format
      console.log("MADE LOCAL")
      return `127.0.0.1:${parts[1]}`;
    }
    return node;
  };

  const handleLocalChange = (e) => {
    const isLocal = e.target.checked;
    setLocal(isLocal);
    console.log("Local mode is now:", e.target.checked);
    // console.log("makeLocal is now:", makeLocal(selectedNode));
    onSelectNode(makeLocal(selectedNode, isLocal));
  }

  const handleEditSave = async () => {
    const check = validateNodeConnection(editValue);
    if (!check.ok) {
      setEditError(check.message);
      return;
    }
    if (check.value !== editingNode && nodes.includes(check.value)) {
      setEditError('That node is already in the list.');
      return;
    }
    try {
      await onEditNode(editingNode, check.value);
    } catch (err) {
      console.error('Failed to edit node:', err);
      setEditError(err.message || 'Failed to edit node.');
      return;
    }
    setEditingNode(null);
    setEditValue('');
    setEditError(null);
  };

  const handleEditCancel = () => {
    setEditingNode(null);
    setEditValue('');
    setEditError(null);
  };

  const handleDropdownChange = async (e) => {
    const value = e.target.value;
    if (value === 'add-node') {
      setShowAddNode(true);
      setEditingNode(null);
    } else if (value === 'remove-node') {
      if (onRemoveNode) {
        try {
          await onRemoveNode(selectedNode);
        } catch (err) {
          console.error('Failed to remove node:', err);
          setError(err.message || 'Failed to remove node.');
        }
      }
    } else if (value === 'edit-node') {
      setEditingNode(selectedNode);
      setEditValue(selectedNode);
      setEditError(null);
      setShowAddNode(false);
    } else {
      onSelectNode(value);
      setShowAddNode(false);
      setEditingNode(null);
    }
  };

  const displayedNodes = [...new Set(nodes.filter(Boolean))];

  // If no node is selected, show connection input
  if (!selectedNode) {
    return (
      <div className="node-picker-container">
        <div className="connection-box">
          <input
            className={`node-picker-input${connectionError ? ' invalid' : ''}`}
            type="text"
            placeholder="IP:Port only (e.g. 192.168.1.1:32349) — no http://"
            value={newNode}
            onChange={(e) => {
              setNewNode(e.target.value);
              if (connectionError) setConnectionError(null);
            }}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          />
          <button className="node-picker-btn primary" onClick={handleAdd}>
            Connect
          </button>
        </div>
        {connectionError && (
          <div className="node-picker-connection-error" role="alert">
            <span className="error-dismiss" onClick={() => setConnectionError(null)}>×</span>
            {connectionError}
          </div>
        )}
        {error && (
          <div className="error">
            <span className="error-dismiss" onClick={() => setError(null)}>×</span>
            {error}
          </div>
        )}
      </div>
    );
  }

  // If node is selected, show dropdown with "Add Node" option
  return (
    <div className="node-picker-container">
      <div className="connected-node-section">
        <select
          className="node-picker-select"
          value={selectedNode}
          onChange={handleDropdownChange}
        >
          {displayedNodes.map((node) => (
            <option key={node} value={node}>
              {node}
            </option>
          ))}
          <option value="add-node">+ Add New Node</option>
          {onEditNode && <option value="edit-node">~ Edit Current Node</option>}
          {onRemoveNode && <option value="remove-node">− Remove Current Node</option>}
        </select>
        <button
          className="node-picker-btn secondary"
          onClick={() => navigate('/dashboard/bookmarks')}
          type="button"
        >
          Update Bookmarks
        </button>
      </div>

      {checking && (
        <div className="node-picker-connecting-msg">
          Verifying node is reachable…
        </div>
      )}
      {connectWarning && (
        <div className="node-picker-warning">
          {connectWarning}
          <button className="node-picker-warning-dismiss" onClick={dismissWarning}>✕</button>
        </div>
      )}

      {editingNode && (
        <div className="add-node-section">
          <input
            className={`node-picker-input${editError ? ' invalid' : ''}`}
            type="text"
            placeholder="IP:Port only (e.g. 192.168.1.1:32349) — no http://"
            value={editValue}
            onChange={(e) => {
              setEditValue(e.target.value);
              if (editError) setEditError(null);
            }}
            onKeyDown={(e) => e.key === 'Enter' && handleEditSave()}
          />
          <button className="node-picker-btn primary" onClick={handleEditSave}>
            Save
          </button>
          <button className="node-picker-btn cancel" onClick={handleEditCancel}>
            Cancel
          </button>
        </div>
      )}
      {editingNode && editError && (
        <div className="node-picker-connection-error" role="alert">
          <span className="error-dismiss" onClick={() => setEditError(null)}>×</span>
          {editError}
        </div>
      )}

      {showAddNode && (
        <div className="add-node-section">
          <input
            className={`node-picker-input${connectionError ? ' invalid' : ''}`}
            type="text"
            placeholder="IP:Port only (e.g. 192.168.1.1:32349) — no http://"
            value={newNode}
            onChange={(e) => {
              setNewNode(e.target.value);
              if (connectionError) setConnectionError(null);
            }}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          />
          <button className="node-picker-btn primary" onClick={handleAdd}>
            Add & Connect
          </button>
          <button className="node-picker-btn cancel" onClick={() => {
            setShowAddNode(false);
            setNewNode('');
            setConnectionError(null);
          }}>
            Cancel
          </button>
        </div>
      )}

      {showAddNode && connectionError && (
        <div className="node-picker-connection-error" role="alert">
          <span className="error-dismiss" onClick={() => setConnectionError(null)}>×</span>
          {connectionError}
        </div>
      )}

      {error && (
        <div className="error">
          <span className="error-dismiss" onClick={() => setError(null)}>×</span>
          {error}
        </div>
      )}
    </div>
  );
};


export default NodePicker;
