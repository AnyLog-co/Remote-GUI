// src/pages/Bookmarks.jsx
import React, { useEffect, useMemo, useState } from "react";
import {
  getBookmarks,
  bookmarkNode,
  deleteBookmarkedNode,
  updateBookmarkDescription,
  updateBookmarkNode,
  setDefaultBookmark
} from "../services/file_auth";
import MaskedNodeAddress from "../components/MaskedNodeAddress";
import { buildBookmarksExport, parseBookmarkJson } from "../utils/bookmarkImport";
import { validateNodeConnection } from "../utils/connectionAddress";
import { maskNodeAddress } from "../utils/maskAddress";
import "../styles/Bookmarks.css";

const Bookmarks = ({ node, nodes = [], onAddNode, onRemoveNode, onEditNode, onSelectNode }) => {
  const [bookmarks, setBookmarks] = useState([]);
  const [newBookmark, setNewBookmark] = useState({
    node: "",
    description: ""
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [nodeSelectionMsg, setNodeSelectionMsg] = useState("");
  const [revealedBookmarkNodes, setRevealedBookmarkNodes] = useState(new Set());

  // Import functionality
  const [importFile, setImportFile] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importPreview, setImportPreview] = useState(null);
  const [importText, setImportText] = useState("");

  // Load bookmarks on component mount and listen for refresh events
  useEffect(() => {
    loadBookmarks();
    
    // Listen for bookmark refresh events from NodePicker
    const handleBookmarkRefresh = () => {
      console.log("Bookmark refresh event received");
      loadBookmarks();
    };
    
    window.addEventListener('bookmark-refresh', handleBookmarkRefresh);
    
    // Cleanup event listener on component unmount
    return () => {
      window.removeEventListener('bookmark-refresh', handleBookmarkRefresh);
    };
  }, []);

  // Auto-clear node selection message
  useEffect(() => {
    if (!nodeSelectionMsg) return;

    const timer = setTimeout(() => {
      setNodeSelectionMsg("");
    }, 3000);

    return () => clearTimeout(timer);
  }, [nodeSelectionMsg]);

  const loadBookmarks = async () => {
    try {
      setLoading(true);
      const res = await getBookmarks();
      setBookmarks(res.data || []);
    } catch (e) {
      console.error("Failed to load bookmarks", e);
      setError("Failed to load bookmarks");
    } finally {
      setLoading(false);
    }
  };

  const displayedBookmarks = useMemo(() => {
    const byNode = new Map();

    bookmarks.forEach((bookmark) => {
      if (bookmark.node) {
        byNode.set(bookmark.node, { ...bookmark, is_saved: true });
      }
    });

    nodes.filter(Boolean).forEach((dropdownNode) => {
      if (!byNode.has(dropdownNode)) {
        byNode.set(dropdownNode, {
          node: dropdownNode,
          description: "",
          created_at: "",
          is_default: false,
          is_saved: false,
        });
      }
    });

    return Array.from(byNode.values());
  }, [bookmarks, nodes]);

  const handleCreateBookmark = async () => {
    const check = validateNodeConnection(newBookmark.node);
    if (!check.ok) {
      setError(check.message);
      return;
    }
    setLoading(true);
    try {
      // Create the bookmark with the node
      const res = onAddNode
        ? await onAddNode(check.value)
        : await bookmarkNode({ node: check.value });
      console.log("Bookmark created:", res);
      
      // If there's a description, update it
      if (newBookmark.description && newBookmark.description.trim()) {
        try {
          await updateBookmarkDescription({ 
            node: check.value, 
            description: newBookmark.description.trim() 
          });
          console.log("Bookmark description updated");
        } catch (descError) {
          console.warn("Failed to update bookmark description:", descError);
          // Don't fail the entire operation if description update fails
        }
      }
      
      // Reload bookmarks to get the updated list
      await loadBookmarks();
      
      setNewBookmark({ node: "", description: "" });
      setError("");
      setSuccessMsg(`Bookmark "${check.value}" created${newBookmark.description ? ' with description' : ''}`);
    } catch (error) {
      setError(error.message || "Failed to create bookmark");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteBookmark = async (node) => {
    if (!window.confirm("Delete this bookmark?")) {
      return;
    }
    setLoading(true);
    try {
      const res = onRemoveNode
        ? await onRemoveNode(node)
        : await deleteBookmarkedNode({ node });
      console.log("Bookmark deleted:", res);
      
      // Reload bookmarks to get the updated list
      await loadBookmarks();
      
      setError("");
      setSuccessMsg("Bookmark deleted");
    } catch (error) {
      setError(error.message || "Failed to delete bookmark");
    } finally {
      setLoading(false);
    }
  };

  const [editingDescriptions, setEditingDescriptions] = useState({});
  const [descriptionValues, setDescriptionValues] = useState({});
  const [editingNodes, setEditingNodes] = useState({});
  const [nodeValues, setNodeValues] = useState({});

  const handleUpdateDescription = async (node, description, isSaved = true) => {
    setLoading(true);
    try {
      if (!isSaved) {
        if (onAddNode) {
          await onAddNode(node);
        } else {
          await bookmarkNode({ node });
        }
      }
      const res = await updateBookmarkDescription({ node, description });
      console.log("Bookmark updated:", res);
      
      // Update the bookmark in the local state
      setBookmarks(prev => prev.map(bookmark => 
        bookmark.node === node 
          ? { ...bookmark, description } 
          : bookmark
      ));
      
      // Clear editing state for this bookmark
      setEditingDescriptions(prev => ({ ...prev, [node]: false }));
      setDescriptionValues(prev => ({ ...prev, [node]: description }));
      
      setError("");
      await loadBookmarks();
      setSuccessMsg("Bookmark description updated");
    } catch (error) {
      setError("Failed to update bookmark description");
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateNode = async (oldNode, nextNode, isSaved) => {
    const check = validateNodeConnection(nextNode);
    if (!check.ok) {
      setError(check.message);
      return;
    }

    const newNode = check.value;
    if (
      newNode !== oldNode &&
      displayedBookmarks.some((bookmark) => bookmark.node === newNode)
    ) {
      setError("That node is already bookmarked.");
      return;
    }

    setLoading(true);
    try {
      if (isSaved) {
        if (onEditNode) {
          await onEditNode(oldNode, newNode);
        } else {
          await updateBookmarkNode({ oldNode, newNode });
        }
      } else {
        if (onRemoveNode) {
          await onRemoveNode(oldNode);
        }
        if (onAddNode) {
          await onAddNode(newNode);
        } else {
          await bookmarkNode({ node: newNode });
        }
      }

      setEditingNodes(prev => ({ ...prev, [oldNode]: false }));
      setNodeValues(prev => {
        const next = { ...prev };
        delete next[oldNode];
        return next;
      });
      await loadBookmarks();
      setError("");
      setSuccessMsg(`Bookmark node updated to ${newNode}`);
    } catch (error) {
      setError(error.message || "Failed to update bookmark node");
    } finally {
      setLoading(false);
    }
  };

  const handleSetDefault = async (node, isSaved = true) => {
    setLoading(true);
    try {
      if (!isSaved) {
        if (onAddNode) {
          await onAddNode(node);
        } else {
          await bookmarkNode({ node });
        }
      }
      await setDefaultBookmark({ node });
      if (onSelectNode) {
        onSelectNode(node);
      }
      window.dispatchEvent(new CustomEvent('bookmark-refresh', {
        detail: { preferDefault: true },
      }));
      // reload to reflect updated flags
      await loadBookmarks();
      setSuccessMsg(`Set ${maskNodeAddress(node)} as default`);
      setError("");
    } catch (error) {
      setError("Failed to set default bookmark");
    } finally {
      setLoading(false);
    }
  };

  const handleUseNode = (node) => {
    if (!onSelectNode) {
      setError("Could not select node from this page.");
      return;
    }

    onSelectNode(node);
    setError("");
    setNodeSelectionMsg(`Selected node: ${maskNodeAddress(node)}`);
  };

  const toggleBookmarkNodeReveal = (node) => {
    setRevealedBookmarkNodes(prev => {
      const next = new Set(prev);
      if (next.has(node)) {
        next.delete(node);
      } else {
        next.add(node);
      }
      return next;
    });
  };

  const handleStartEditing = (node, currentDescription) => {
    setEditingDescriptions(prev => ({ ...prev, [node]: true }));
    setDescriptionValues(prev => ({ ...prev, [node]: currentDescription || "" }));
  };

  const handleStartNodeEditing = (node) => {
    setEditingNodes(prev => ({ ...prev, [node]: true }));
    setNodeValues(prev => ({ ...prev, [node]: node }));
  };

  const handleCancelEditing = (node) => {
    setEditingDescriptions(prev => ({ ...prev, [node]: false }));
    setDescriptionValues(prev => ({ ...prev, [node]: "" }));
  };

  const handleCancelNodeEditing = (node) => {
    setEditingNodes(prev => ({ ...prev, [node]: false }));
    setNodeValues(prev => ({ ...prev, [node]: "" }));
  };

  // Import functionality
  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    if (file.type !== 'application/json' && !file.name.endsWith('.json')) {
      setError("Please select a valid JSON file");
      return;
    }

    setImportFile(file);
    setError("");

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsedBookmarks = parseBookmarkJson(e.target.result);
        setImportPreview(parsedBookmarks);
        setImportText(e.target.result);
      } catch (parseError) {
        setError(`Invalid bookmark JSON: ${parseError.message}`);
        setImportPreview(null);
      }
    };
    reader.readAsText(file);
  };

  const importBookmarks = async (payload) => {
    if (!payload || !Array.isArray(payload.bookmarks)) {
      setError("Invalid import data format - expected bookmarks to import");
      return;
    }

    setImporting(true);
    setError("");
    let importedCount = 0;
    let errors = [];

    try {
      for (const bookmarkData of payload.bookmarks) {
        try {
          // Create the bookmark
          if (onAddNode) {
            await onAddNode(bookmarkData.node);
          } else {
            await bookmarkNode({ node: bookmarkData.node });
          }
          
          // If there's a description, update it
          if (bookmarkData.description && bookmarkData.description.trim()) {
            await updateBookmarkDescription({ 
              node: bookmarkData.node, 
              description: bookmarkData.description.trim() 
            });
          }
          
          importedCount++;
        } catch (bookmarkError) {
          errors.push(`Failed to create bookmark "${bookmarkData.node}": ${bookmarkError.message}`);
        }
      }

      // Reload bookmarks after import
      await loadBookmarks();

      // Show results
      if (errors.length > 0) {
        setError(`Import completed with ${errors.length} errors. Imported ${importedCount} bookmarks. Errors: ${errors.join('; ')}`);
      } else {
        const duplicateNote = payload.duplicateCount
          ? ` Ignored ${payload.duplicateCount} duplicate${payload.duplicateCount === 1 ? "" : "s"} inside the input.`
          : "";
        setSuccessMsg(`Successfully imported ${importedCount} bookmarks.${duplicateNote}`);
      }

      // Clear import state
      setImportFile(null);
      setImportPreview(null);
      setImportText("");
      setImporting(false);
    } catch (error) {
      setError(`Import failed: ${error.message}`);
      setImporting(false);
    }
  };

  const handleImport = async () => {
    await importBookmarks(importPreview);
  };

  const handleImportText = async () => {
    if (!importText.trim()) {
      setError("Paste bookmark JSON before importing.");
      setImportPreview(null);
      return;
    }

    try {
      const parsedBookmarks = parseBookmarkJson(importText);
      setImportPreview(parsedBookmarks);
      await importBookmarks(parsedBookmarks);
    } catch (parseError) {
      setImportPreview(null);
      setError(`Invalid bookmark JSON: ${parseError.message}`);
    }
  };

  const handleCancelImport = () => {
    setImportFile(null);
    setImportPreview(null);
    setImportText("");
    setError("");
  };

  // Export functionality
  const getExportData = () => buildBookmarksExport(displayedBookmarks);

  const copyTextToClipboard = async (text) => {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return;
      } catch (error) {
        console.warn('Clipboard API failed, falling back to textarea copy:', error);
      }
    }

    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.setAttribute('readonly', '');
    textArea.style.position = 'fixed';
    textArea.style.left = '-9999px';
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand('copy');
    document.body.removeChild(textArea);
  };

  const handleCopyBookmarks = async (event) => {
    event.preventDefault();
    const exportData = getExportData();
    const bookmarkCount = exportData.bookmarks.length;
    if (bookmarkCount === 0) {
      setError("No bookmarks to copy");
      return;
    }

    try {
      await copyTextToClipboard(JSON.stringify(exportData, null, 2));
      setSuccessMsg(`Copied ${bookmarkCount} bookmarks`);
      setError("");
    } catch (error) {
      setError(`Copy failed: ${error.message}`);
    }
  };

  const handleExport = async () => {
    const exportData = getExportData();
    const bookmarkCount = exportData.bookmarks.length;
    if (bookmarkCount === 0) {
      setError("No bookmarks to export");
      return;
    }

    try {
      // Create and download JSON file
      const dataStr = JSON.stringify(exportData, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(dataBlob);
      
      const link = document.createElement('a');
      link.href = url;
      link.download = `bookmarks-export-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      setSuccessMsg(`Exported ${bookmarkCount} bookmarks`);
    } catch (error) {
      setError(`Export failed: ${error.message}`);
    }
  };

  return (
    <div className="container">
      <section className="import-section">
        <h2>📁 Import Bookmarks from JSON</h2>
        <div className="import-container">
          <div className="import-export-actions">
            <input
              type="file"
              accept=".json"
              onChange={handleFileUpload}
              disabled={importing}
              className="file-input"
            />
            <button 
              type="button"
              onClick={handleExport} 
              disabled={displayedBookmarks.length === 0}
              className="export-btn"
              title="Export all bookmarks as JSON"
            >
              📤 Export All Bookmarks
            </button>
            <button
              type="button"
              onClick={handleCopyBookmarks}
              disabled={displayedBookmarks.length === 0}
              className="copy-btn"
              title="Copy all bookmarks as JSON"
            >
              Copy Bookmarks
            </button>
          </div>
          <div className="paste-import">
            <textarea
              value={importText}
              onChange={(event) => {
                setImportText(event.target.value);
                setImportPreview(null);
                if (error) setError("");
              }}
              placeholder='[{"node":"192.168.0.138:32149","description":"Primary node"}]'
              rows={6}
              disabled={importing}
            />
            <button
              onClick={handleImportText}
              disabled={importing || !importText.trim()}
              className="import-btn"
            >
              {importing ? "Importing..." : "Import Pasted Bookmarks"}
            </button>
          </div>
          {importFile && (
            <div className="file-info">
              <p>Selected file: {importFile.name}</p>
              {importPreview && (
                <div className="import-preview">
                  <h4>Preview:</h4>
                  <ul>
                    {importPreview.bookmarks.map((bookmark, index) => (
                      <li key={index}>
                        <strong>
                          <MaskedNodeAddress
                            value={bookmark.node}
                            revealed={revealedBookmarkNodes.has(`preview-${index}-${bookmark.node}`)}
                            onToggle={() => toggleBookmarkNodeReveal(`preview-${index}-${bookmark.node}`)}
                            label="import preview node"
                          />
                        </strong>
                        {bookmark.description && ` - ${bookmark.description}`}
                      </li>
                    ))}
                  </ul>
                  {importPreview.duplicateCount > 0 && (
                    <p className="import-duplicate-note">
                      {importPreview.duplicateCount} duplicate{importPreview.duplicateCount === 1 ? "" : "s"} inside the input will be ignored.
                    </p>
                  )}
                  <div className="import-actions">
                    <button 
                      onClick={handleImport} 
                      disabled={importing}
                      className="import-btn"
                    >
                      {importing ? "Importing..." : "Import All"}
                    </button>
                    <button 
                      onClick={handleCancelImport} 
                      disabled={importing}
                      className="cancel-btn"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      <section className="bookmark-section">
        <h2>➕ Add & View Bookmarks</h2>
        <div className="form-row">
          <input
            type="text"
            placeholder="Node ip:port"
            value={newBookmark.node}
            onChange={e => setNewBookmark({ ...newBookmark, node: e.target.value })}
          />
          <input
            type="text"
            placeholder="Description (optional)"
            value={newBookmark.description}
            onChange={e => setNewBookmark({ ...newBookmark, description: e.target.value })}
          />
          <button onClick={handleCreateBookmark} disabled={loading}>
            Add Bookmark
          </button>
        </div>

        <ul className="bookmark-list">
          {displayedBookmarks.length === 0 ? (
            <li className="empty-state">
              <div className="bookmark-content">
                <div className="bookmark-node" style={{ textAlign: 'center', color: '#6c757d', fontStyle: 'italic' }}>
                  No bookmarks yet. Add your first bookmark above!
                </div>
              </div>
            </li>
          ) : (
            displayedBookmarks.map(bookmark => {
              const isActiveNode = bookmark.node === node;

              return (
              <li
                key={bookmark.node}
                className={isActiveNode ? "active-bookmark" : ""}
              >
                <div className="bookmark-content">
                  <div className="bookmark-header">
                    {editingNodes[bookmark.node] ? (
                      <div className="node-edit-container">
                        <input
                          type="text"
                          value={nodeValues[bookmark.node] || ""}
                          onChange={(event) => setNodeValues(prev => ({
                            ...prev,
                            [bookmark.node]: event.target.value,
                          }))}
                          className="node-input"
                          placeholder="IP:Port"
                        />
                        <button
                          className="save-btn"
                          disabled={loading}
                          onClick={() => handleUpdateNode(bookmark.node, nodeValues[bookmark.node], bookmark.is_saved)}
                        >
                          Save Node
                        </button>
                        <button
                          className="cancel-btn"
                          disabled={loading}
                          onClick={() => handleCancelNodeEditing(bookmark.node)}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="node-display-container">
                        <MaskedNodeAddress
                          value={bookmark.node}
                          revealed={revealedBookmarkNodes.has(bookmark.node)}
                          onToggle={() => toggleBookmarkNodeReveal(bookmark.node)}
                          className="bookmark-node"
                          label="bookmark node"
                        />
                        <button
                          className="node-edit-btn"
                          disabled={loading}
                          onClick={() => handleStartNodeEditing(bookmark.node)}
                          title="Edit IP and port"
                          aria-label="Edit IP and port"
                        >
                          ✏️
                        </button>
                      </div>
                    )}
                    {bookmark.is_default && (
                      <span className="default-badge" style={{
                        marginLeft: '0.5rem',
                        backgroundColor: '#ffd54f',
                        color: '#000',
                        borderRadius: '4px',
                        padding: '2px 6px',
                        fontSize: '0.8rem',
                        fontWeight: 600
                      }}>
                        Default
                      </span>
                    )}
                    {!bookmark.is_saved && (
                      <span className="unsaved-badge">Dropdown only</span>
                    )}
                    {bookmark.created_at && (
                      <span className="bookmark-date">
                        {new Date(bookmark.created_at).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                  <div className="bookmark-description">
                    {editingDescriptions[bookmark.node] ? (
                      <div className="description-edit-container">
                        <input
                          type="text"
                          placeholder="Add description..."
                          value={descriptionValues[bookmark.node] || ""}
                          onChange={(e) => setDescriptionValues(prev => ({ 
                            ...prev, 
                            [bookmark.node]: e.target.value 
                          }))}
                          className="description-input"
                        />
                        <div className="description-actions">
                          <button
                            className="save-btn"
                            disabled={loading}
                            onClick={() => handleUpdateDescription(bookmark.node, descriptionValues[bookmark.node], bookmark.is_saved)}
                            title="Save description"
                          >
                            💾 Save
                          </button>
                          <button
                            className="cancel-btn"
                            disabled={loading}
                            onClick={() => handleCancelEditing(bookmark.node)}
                            title="Cancel editing"
                          >
                            ❌ Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="description-display-container">
                        <span className="description-text">
                          {bookmark.description || "No description"}
                        </span>
                        <button
                          className="edit-btn"
                          disabled={loading}
                          onClick={() => handleStartEditing(bookmark.node, bookmark.description)}
                          title="Edit description"
                        >
                          ✏️ Edit
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                <div className="bookmark-actions">
                  <button
                    className="use-node-btn"
                    disabled={loading || bookmark.is_default}
                    onClick={() => handleSetDefault(bookmark.node, bookmark.is_saved)}
                    title={bookmark.is_default ? "Already default" : "Set as default"}
                  >
                    {bookmark.is_default ? '⭐ Default' : 'Set as default'}
                  </button>
                  <button
                    className={`use-node-btn${isActiveNode ? " active-node-btn" : ""}`}
                    disabled={loading || isActiveNode}
                    onClick={() => handleUseNode(bookmark.node)}
                    title={isActiveNode ? "This node is currently active" : "Use this node as selected node"}
                    aria-current={isActiveNode ? "true" : undefined}
                  >
                    {isActiveNode ? "Active Node" : "✅ Use Node"}
                  </button>
                  <button
                    className="delete-btn"
                    disabled={loading}
                    onClick={() => handleDeleteBookmark(bookmark.node)}
                    title="Delete bookmark"
                  >
                    🗑️
                  </button>
                </div>
              </li>
              );
            })
          )}
        </ul>
      </section>

      {error && <div className="error-message"><span className="error-dismiss" onClick={() => setError("")}>×</span>{error}</div>}
      {successMsg && (
        <div className="success-message">{successMsg}</div>
      )}
      {nodeSelectionMsg && (
        <div className="success-message">{nodeSelectionMsg}</div>
      )}
    </div>
  );
};

export default Bookmarks;
