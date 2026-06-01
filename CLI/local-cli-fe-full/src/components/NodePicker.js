// src/components/NodePicker.js
import React, { useState, useRef } from 'react';
import { getConnectedNodes, checkNodeReachable } from '../services/api';
import { bookmarkNode, getBookmarks, updateBookmarkDescription } from '../services/file_auth';
import '../styles/NodePicker.css';
import { isLoggedIn } from '../services/file_auth';
import { useEffect } from 'react';
import { validateNodeConnection } from '../utils/connectionAddress';

const NodePicker = ({ nodes, selectedNode, onAddNode, onRemoveNode, onEditNode, onSelectNode, onBookmarkAdded }) => {
  const [newNode, setNewNode] = useState('');
  const [connectionError, setConnectionError] = useState(null);
  const [connectWarning, setConnectWarning] = useState(null);
  const [error, setError] = useState(null);
  const [local, setLocal] = useState(false);
  const [bookmarkMsg, setBookmarkMsg] = useState(null);
  const [showAddNode, setShowAddNode] = useState(false);
  const [checking, setChecking] = useState(false);
  const [editingNode, setEditingNode] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [editError, setEditError] = useState(null);
  const [showUploadBookmarks, setShowUploadBookmarks] = useState(false);
  const [bookmarkJsonText, setBookmarkJsonText] = useState('');
  const [uploadStatus, setUploadStatus] = useState(null);
  const [uploadError, setUploadError] = useState(null);
  const [uploadingBookmarks, setUploadingBookmarks] = useState(false);
  const [isDraggingBookmarkFile, setIsDraggingBookmarkFile] = useState(false);
  const abortRef = useRef(null);
  const bookmarkFileInputRef = useRef(null);

  useEffect(() => {
    if (!bookmarkMsg) return;

    const timer = setTimeout(() => {
      setBookmarkMsg(null);
    }, 5000);

    return () => clearTimeout(timer);
  }, [bookmarkMsg]);

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

  const handleAdd = () => {
    const check = validateNodeConnection(newNode);
    if (!check.ok) {
      setConnectionError(check.message);
      return;
    }
    setConnectionError(null);
    setConnectWarning(null);

    onAddNode(check.value);
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
        onAddNode(node);
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

  const handleBookmark = async () => {
    if (!selectedNode) {
      setBookmarkMsg('No node selected to bookmark.');
      return;
    }
    setError(null);
    setBookmarkMsg(null);

    try {
      if (isLoggedIn()) {
        await bookmarkNode({ node: selectedNode });
        setBookmarkMsg(`Bookmarked ${selectedNode}!`);
        
        // Dispatch event to refresh bookmarks globally
        window.dispatchEvent(new Event('bookmark-refresh'));
        
        // Call the callback to refresh bookmarks in parent component
        if (onBookmarkAdded) {
          onBookmarkAdded();
        }
      }
    } catch (err) {
      console.error('Bookmark failed:', err);
      setError('Could not bookmark node. Try again.');
    }
  };

  const getBookmarkNodeValue = (bookmark) => {
    if (typeof bookmark === 'string') {
      return bookmark.trim();
    }

    if (!bookmark || typeof bookmark !== 'object') {
      return '';
    }

    if (typeof bookmark.node === 'string') {
      return bookmark.node.trim();
    }

    if (bookmark.node && typeof bookmark.node === 'object' && typeof bookmark.node.conn === 'string') {
      return bookmark.node.conn.trim();
    }

    if (typeof bookmark.conn === 'string') {
      return bookmark.conn.trim();
    }

    return '';
  };

  const getBookmarkDescription = (bookmark) => {
    if (!bookmark || typeof bookmark !== 'object') {
      return '';
    }

    return typeof bookmark.description === 'string' ? bookmark.description.trim() : '';
  };

  const parseBookmarkJson = (jsonText) => {
    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch (err) {
      throw new Error(`Invalid JSON: ${err.message}`);
    }

    const rawBookmarks = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.bookmarks)
        ? parsed.bookmarks
        : null;

    if (!rawBookmarks) {
      throw new Error('Expected a JSON array or an object with a "bookmarks" array.');
    }

    const seen = new Set();
    const normalizedBookmarks = [];
    let sourceDuplicateCount = 0;

    rawBookmarks.forEach((bookmark, index) => {
      const node = getBookmarkNodeValue(bookmark);
      if (!node) {
        throw new Error(`Bookmark ${index + 1} is missing a node value.`);
      }

      if (seen.has(node)) {
        sourceDuplicateCount++;
        return;
      }

      seen.add(node);
      normalizedBookmarks.push({
        node,
        description: getBookmarkDescription(bookmark),
      });
    });

    return {
      bookmarks: normalizedBookmarks,
      duplicateCount: sourceDuplicateCount,
    };
  };

  const showUploadError = (message) => {
    setUploadError(message);
    setUploadStatus(null);
    window.alert(message);
  };

  const importBookmarkText = async (jsonText) => {
    if (!jsonText.trim()) {
      showUploadError('Please provide bookmark JSON before importing.');
      return;
    }

    let importPayload;
    try {
      importPayload = parseBookmarkJson(jsonText);
    } catch (err) {
      showUploadError(`Could not process bookmarks JSON. ${err.message}`);
      return;
    }

    setUploadingBookmarks(true);
    setUploadError(null);
    setUploadStatus(null);

    try {
      const existingResponse = await getBookmarks();
      const existingBookmarks = Array.isArray(existingResponse.data) ? existingResponse.data : [];
      const existingNodes = new Set(existingBookmarks.map((bookmark) => bookmark.node).filter(Boolean));
      const importedNodes = [];
      let savedDuplicateCount = 0;

      for (const bookmark of importPayload.bookmarks) {
        if (existingNodes.has(bookmark.node)) {
          savedDuplicateCount++;
          continue;
        }

        await bookmarkNode({ node: bookmark.node });
        existingNodes.add(bookmark.node);
        importedNodes.push(bookmark.node);

        if (bookmark.description) {
          try {
            await updateBookmarkDescription({
              node: bookmark.node,
              description: bookmark.description,
            });
          } catch (descriptionError) {
            console.warn('Failed to update imported bookmark description:', descriptionError);
          }
        }
      }

      const dropdownNodes = importPayload.bookmarks.map((bookmark) => bookmark.node);
      dropdownNodes.forEach((node) => onAddNode(node));
      if (!selectedNode && dropdownNodes.length > 0) {
        onSelectNode(dropdownNodes[0]);
      }

      window.dispatchEvent(new Event('bookmark-refresh'));

      if (onBookmarkAdded) {
        onBookmarkAdded();
      }

      setBookmarkJsonText('');
      if (bookmarkFileInputRef.current) {
        bookmarkFileInputRef.current.value = '';
      }
      const sourceDuplicateMessage = importPayload.duplicateCount > 0
        ? ` Ignored ${importPayload.duplicateCount} duplicate${importPayload.duplicateCount === 1 ? '' : 's'} inside the uploaded JSON.`
        : '';
      setUploadStatus(`Added ${importedNodes.length} new bookmark${importedNodes.length === 1 ? '' : 's'}. Synced ${savedDuplicateCount} already-saved bookmark${savedDuplicateCount === 1 ? '' : 's'} to the dropdown.${sourceDuplicateMessage}`);
    } catch (err) {
      console.error('Bookmark import failed:', err);
      showUploadError(`Bookmark import failed: ${err.message}`);
    } finally {
      setUploadingBookmarks(false);
    }
  };

  const handleBookmarkFile = (file) => {
    if (!file) {
      return;
    }

    if (file.type !== 'application/json' && !file.name.endsWith('.json')) {
      showUploadError('Please upload a JSON file.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      importBookmarkText(event.target.result || '');
    };
    reader.onerror = () => {
      showUploadError('Could not read the selected JSON file.');
    };
    reader.readAsText(file);
  };

  const closeUploadBookmarks = () => {
    setShowUploadBookmarks(false);
    setBookmarkJsonText('');
    setUploadError(null);
    setUploadStatus(null);
    setIsDraggingBookmarkFile(false);
    if (bookmarkFileInputRef.current) {
      bookmarkFileInputRef.current.value = '';
    }
  };

  const handleEditSave = () => {
    const check = validateNodeConnection(editValue);
    if (!check.ok) {
      setEditError(check.message);
      return;
    }
    if (check.value !== editingNode && nodes.includes(check.value)) {
      setEditError('That node is already in the list.');
      return;
    }
    onEditNode(editingNode, check.value);
    setEditingNode(null);
    setEditValue('');
    setEditError(null);
  };

  const handleEditCancel = () => {
    setEditingNode(null);
    setEditValue('');
    setEditError(null);
  };

  const handleDropdownChange = (e) => {
    const value = e.target.value;
    if (value === 'add-node') {
      setShowAddNode(true);
      setEditingNode(null);
    } else if (value === 'remove-node') {
      if (onRemoveNode) onRemoveNode(selectedNode);
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
        {bookmarkMsg && (
          <div className="bookmark-msg">
            {bookmarkMsg}
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
        
        <button className="node-picker-btn secondary" onClick={handleBookmark}>
          Bookmark
        </button>
        <button
          className="node-picker-btn secondary"
          onClick={() => setShowUploadBookmarks(true)}
          type="button"
        >
          Upload Bookmarks
        </button>
      </div>

      {showUploadBookmarks && (
        <div className="bookmark-upload-backdrop" role="presentation">
          <div className="bookmark-upload-modal" role="dialog" aria-modal="true" aria-labelledby="bookmark-upload-title">
            <div className="bookmark-upload-header">
              <h2 id="bookmark-upload-title">Upload Bookmarks</h2>
              <button
                className="bookmark-upload-close"
                type="button"
                onClick={closeUploadBookmarks}
                aria-label="Close upload bookmarks"
              >
                ×
              </button>
            </div>

            <div className="bookmark-upload-options">
              <section
                className={`bookmark-drop-zone${isDraggingBookmarkFile ? ' dragging' : ''}`}
                onDragOver={(event) => {
                  event.preventDefault();
                  setIsDraggingBookmarkFile(true);
                }}
                onDragLeave={() => setIsDraggingBookmarkFile(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setIsDraggingBookmarkFile(false);
                  handleBookmarkFile(event.dataTransfer.files[0]);
                }}
              >
                <h3>Drag and drop JSON file</h3>
                <p>Drop a bookmarks JSON file here, or choose one from your computer.</p>
                <input
                  ref={bookmarkFileInputRef}
                  type="file"
                  accept=".json,application/json"
                  onChange={(event) => handleBookmarkFile(event.target.files[0])}
                  disabled={uploadingBookmarks}
                />
              </section>

              <section className="bookmark-paste-zone">
                <h3>Paste JSON string</h3>
                <textarea
                  value={bookmarkJsonText}
                  onChange={(event) => setBookmarkJsonText(event.target.value)}
                  placeholder='{"bookmarks":[{"node":{"conn":"192.168.0.138:32149"},"description":""}]}'
                  rows={8}
                  disabled={uploadingBookmarks}
                />
                <button
                  className="node-picker-btn primary"
                  type="button"
                  onClick={() => importBookmarkText(bookmarkJsonText)}
                  disabled={uploadingBookmarks || !bookmarkJsonText.trim()}
                >
                  {uploadingBookmarks ? 'Importing...' : 'Import Pasted JSON'}
                </button>
              </section>
            </div>

            {uploadError && (
              <div className="bookmark-upload-error" role="alert">
                {uploadError}
              </div>
            )}
            {uploadStatus && (
              <div className="bookmark-upload-status" role="status">
                {uploadStatus}
              </div>
            )}
          </div>
        </div>
      )}

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

      {bookmarkMsg && (
        <div className="bookmark-msg">
          {bookmarkMsg}
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
