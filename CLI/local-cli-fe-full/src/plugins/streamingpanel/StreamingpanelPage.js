import React, { useState, useEffect } from "react";
import { getStreams, getPlayerIframeUrl } from "./streamingpanel_api";

export const pluginMetadata = {
  name: "Streaming Panel",
  icon: null,
};

const StreamingpanelPage = () => {
  const [streamOptions, setStreamOptions] = useState([]);
  const [selectedStreams, setSelectedStreams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [expandedStream, setExpandedStream] = useState(null);
  const [streamSelectorOpen, setStreamSelectorOpen] = useState(false);

  useEffect(() => {
    const loadStreams = async () => {
      try {
        setLoading(true);
        setError(null);
        const list = await getStreams();
        setStreamOptions(list);
      } catch (err) {
        console.error("Failed to load stream options:", err);
        setError("Failed to load stream options. Please check backend.");
      } finally {
        setLoading(false);
      }
    };
    loadStreams();
  }, []);

  const toggleStreamSelection = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const addSelectedStreams = () => {
    const toAdd = streamOptions.filter(
      (opt) => selectedIds.has(opt.id) && !selectedStreams.some((s) => s.id === opt.id)
    );
    if (toAdd.length === 0) return;
    setSelectedStreams((prev) => [...prev, ...toAdd]);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      toAdd.forEach((opt) => next.delete(opt.id));
      return next;
    });
  };

  const removeStream = (id) => {
    setSelectedStreams((prev) => prev.filter((s) => s.id !== id));
    if (expandedStream?.id === id) setExpandedStream(null);
  };

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          height: "100vh",
          padding: "20px",
          backgroundColor: "#f8f9fa",
          color: "#333",
        }}
      >
        <p>Loading stream options...</p>
      </div>
    );
  }

  return (
    <div
      style={{
        position: "relative",
        margin: "-20px",
        width: "calc(100% + 40px)",
        height: "calc(100% + 40px)",
        minHeight: "calc(100vh - 120px)",
        display: "flex",
        flexDirection: "column",
        padding: 0,
        overflow: "hidden",
        backgroundColor: "#f8f9fa",
        boxSizing: "border-box",
      }}
    >
      {/* Header: match MCP Client – title + collapsible stream selector */}
      <div
        style={{
          padding: "20px",
          backgroundColor: "#ffffff",
          borderBottom: "2px solid #007bff",
          display: "flex",
          flexDirection: "column",
          flexShrink: 0,
          boxShadow: "0 2px 4px rgba(0, 0, 0, 0.1)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "10px",
          }}
        >
          <h2
            style={{
              margin: 0,
              color: "#333",
              fontSize: "24px",
              fontWeight: "600",
              borderBottom: "2px solid #007bff",
              paddingBottom: "10px",
              display: "inline-block",
            }}
          >
            Streaming Panel
          </h2>

          <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
            {error && (
              <span style={{ color: "#721c24", fontSize: "14px" }}>{error}</span>
            )}
            <button
              type="button"
              onClick={() => setStreamSelectorOpen((o) => !o)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "10px 20px",
                fontSize: "14px",
                background: streamSelectorOpen ? "#0056b3" : "#007bff",
                color: "white",
                border: "none",
                borderRadius: "6px",
                cursor: "pointer",
                fontWeight: "500",
              }}
            >
              {streamSelectorOpen ? "Hide stream list" : "Add streams"}
              <span
                style={{
                  display: "inline-block",
                  transform: streamSelectorOpen ? "rotate(180deg)" : "rotate(0deg)",
                  transition: "transform 0.2s ease",
                  fontSize: "10px",
                }}
              >
                ▼
              </span>
            </button>
          </div>
        </div>

        {/* Collapsible: stream checklist (same pattern as MCP Config panel) */}
        {streamSelectorOpen && (() => {
          const addableIds = streamOptions
            .filter((opt) => !selectedStreams.some((s) => s.id === opt.id))
            .map((opt) => opt.id);
          const allAddableSelected =
            addableIds.length > 0 && addableIds.every((id) => selectedIds.has(id));
          return (
            <div
              style={{
                padding: "20px",
                backgroundColor: "#ffffff",
                borderBottom: "1px solid #dee2e6",
                flexShrink: 0,
                marginTop: "16px",
              }}
            >
              <h3 style={{ marginTop: 0, marginBottom: "15px" }}>Select streams to add</h3>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "flex-start",
                  gap: "15px",
                }}
              >
                <div
                  style={{
                    border: "1px solid #ced4da",
                    borderRadius: "6px",
                    padding: "12px 16px",
                    maxHeight: "220px",
                    overflowY: "auto",
                    minWidth: "260px",
                  }}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    {streamOptions.map((opt) => {
                      const alreadyAdded = selectedStreams.some((s) => s.id === opt.id);
                      return (
                        <label
                          key={opt.id}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "10px",
                            padding: "6px 8px",
                            cursor: alreadyAdded ? "default" : "pointer",
                            borderRadius: "4px",
                            backgroundColor: alreadyAdded ? "#e9ecef" : "transparent",
                            opacity: alreadyAdded ? 0.7 : 1,
                            fontWeight: "500",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={selectedIds.has(opt.id)}
                            onChange={() => !alreadyAdded && toggleStreamSelection(opt.id)}
                            disabled={alreadyAdded}
                            style={{ width: "16px", height: "16px", accentColor: "#007bff" }}
                          />
                          <span style={{ fontSize: "14px", color: "#333" }}>{opt.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={() =>
                      allAddableSelected
                        ? setSelectedIds(new Set())
                        : setSelectedIds(new Set(addableIds))
                    }
                    disabled={addableIds.length === 0}
                    style={{
                      padding: "10px 20px",
                      fontSize: "14px",
                      background: addableIds.length === 0 ? "#6c757d" : "#007bff",
                      color: "white",
                      border: "none",
                      borderRadius: "6px",
                      cursor: addableIds.length === 0 ? "not-allowed" : "pointer",
                      fontWeight: "500",
                      opacity: addableIds.length === 0 ? 0.6 : 1,
                    }}
                  >
                    {allAddableSelected ? "Deselect all" : "Select all"}
                  </button>
                  <button
                    type="button"
                    onClick={addSelectedStreams}
                    disabled={selectedIds.size === 0}
                    style={{
                      padding: "10px 20px",
                      fontSize: "14px",
                      background: selectedIds.size > 0 ? "#28a745" : "#6c757d",
                      color: "white",
                      border: "none",
                      borderRadius: "6px",
                      cursor: selectedIds.size > 0 ? "pointer" : "not-allowed",
                      fontWeight: "500",
                      opacity: selectedIds.size === 0 ? 0.6 : 1,
                    }}
                  >
                    Add selected to panel
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Active streams chips */}
        {selectedStreams.length > 0 && (
          <div
            style={{
              padding: "12px 0 0",
              marginTop: "12px",
              borderTop: "1px solid #dee2e6",
              display: "flex",
              flexWrap: "wrap",
              gap: "8px",
              alignItems: "center",
            }}
          >
            <span
              style={{
                fontSize: "14px",
                color: "#495057",
                marginRight: "8px",
                fontWeight: "500",
              }}
            >
              On panel:
            </span>
            {selectedStreams.map((s) => (
              <span
                key={s.id}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "6px 12px",
                  backgroundColor: "#e7f1ff",
                  border: "1px solid #b6d4fe",
                  borderRadius: "6px",
                  fontSize: "14px",
                  color: "#084298",
                }}
              >
                {s.label}
                <button
                  type="button"
                  onClick={() => removeStream(s.id)}
                  aria-label={`Remove ${s.label}`}
                  style={{
                    background: "none",
                    border: "none",
                    color: "#084298",
                    cursor: "pointer",
                    padding: "0 2px",
                    fontSize: "16px",
                    lineHeight: 1,
                    opacity: 0.8,
                  }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Warning when > 6 streams: browser connection limit */}
      {selectedStreams.length > 6 && (
        <div
          style={{
            padding: "12px 20px",
            backgroundColor: "#fff3cd",
            borderBottom: "1px solid #ffc107",
            fontSize: "14px",
            color: "#856404",
            fontWeight: "500",
            flexShrink: 0,
          }}
        >
          <strong>Note:</strong> Browsers allow only about 6 simultaneous connections to the same
          server. Streams beyond the 6th may not load or may show black. Use 6 or fewer panels per
          stream server, or use streams from different servers if you need more.
        </div>
      )}

      {/* Grid of streams - grid fills full content area; each tile and video scale with panel */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          backgroundColor: "#f8f9fa",
          width: "100%",
        }}
      >
        {selectedStreams.length === 0 ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              flex: 1,
              color: "#6c757d",
              textAlign: "center",
              padding: "24px",
            }}
          >
            <p style={{ fontSize: "16px", marginBottom: "8px" }}>
              No streams selected
            </p>
            <p style={{ fontSize: "14px" }}>
              Check one or more streams in the list above and click &quot;Add selected to panel&quot; to
              show live streams in a grid (security camera style).
            </p>
          </div>
        ) : (
          <div
            style={{
              flex: 1,
              minHeight: 0,
              minWidth: 0,
              padding: "16px",
              boxSizing: "border-box",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              width: "100%",
            }}
          >
            <div
              style={{
                flex: 1,
                minHeight: 0,
                minWidth: 0,
                width: "100%",
                overflow: "auto",
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                gridAutoRows: "auto",
                gap: "16px",
                alignContent: "start",
                justifyItems: "stretch",
                boxSizing: "border-box",
              }}
            >
              {selectedStreams.map((stream) => (
                <div
                  key={stream.id}
                  style={{
                    minWidth: 0,
                    display: "flex",
                    flexDirection: "column",
                    backgroundColor: "#ffffff",
                    borderRadius: "8px",
                    overflow: "hidden",
                    border: "1px solid #dee2e6",
                    boxShadow: "0 2px 4px rgba(0, 0, 0, 0.1)",
                    width: "100%",
                  }}
                >
                  <div
                    style={{
                      padding: "10px 12px",
                      backgroundColor: "#ffffff",
                      borderBottom: "1px solid #dee2e6",
                      fontSize: "14px",
                      fontWeight: "500",
                      color: "#333",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      flexShrink: 0,
                      gap: "10px",
                    }}
                  >
                    <span style={{ flex: 1, minWidth: 0 }}>{stream.label}</span>
                    <button
                      type="button"
                      onClick={() => setExpandedStream(stream)}
                      aria-label={`Expand ${stream.label}`}
                      title="Expand"
                      style={{
                        padding: "10px 20px",
                        fontSize: "14px",
                        background: "#007bff",
                        color: "white",
                        border: "none",
                        borderRadius: "6px",
                        cursor: "pointer",
                        fontWeight: "500",
                      }}
                    >
                      Expand
                    </button>
                    <button
                      type="button"
                      onClick={() => removeStream(stream.id)}
                      aria-label={`Remove ${stream.label}`}
                      style={{
                        padding: "6px 10px",
                        fontSize: "14px",
                        background: "#6c757d",
                        color: "white",
                        border: "none",
                        borderRadius: "6px",
                        cursor: "pointer",
                        fontWeight: "500",
                      }}
                    >
                      ×
                    </button>
                  </div>
                  <div
                    style={{
                      position: "relative",
                      width: "100%",
                      aspectRatio: stream.aspect_ratio != null ? String(stream.aspect_ratio) : "16 / 9",
                      minHeight: "180px",
                      overflow: "hidden",
                      backgroundColor: "#000",
                    }}
                  >
                    <iframe
                      src={getPlayerIframeUrl(stream.url, stream.width, stream.height)}
                      title={stream.label}
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        width: "100%",
                        height: "100%",
                        border: "none",
                      }}
                      allow="autoplay; fullscreen"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Expand overlay: stream shown larger on top of the panel */}
      {expandedStream && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 9999,
            backgroundColor: "rgba(0, 0, 0, 0.85)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
            boxSizing: "border-box",
          }}
          onClick={(e) => e.target === e.currentTarget && setExpandedStream(null)}
        >
          <div
            style={{
              width: "100%",
              maxWidth: "95vw",
              height: "100%",
              maxHeight: "95vh",
              display: "flex",
              flexDirection: "column",
              backgroundColor: "#ffffff",
              borderRadius: "8px",
              overflow: "hidden",
              boxShadow: "0 8px 32px rgba(0, 0, 0, 0.3)",
              border: "1px solid #dee2e6",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                padding: "20px",
                backgroundColor: "#ffffff",
                borderBottom: "2px solid #007bff",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexShrink: 0,
              }}
            >
              <span style={{ fontSize: "24px", fontWeight: "600", color: "#333" }}>
                {expandedStream.label}
              </span>
              <button
                type="button"
                onClick={() => setExpandedStream(null)}
                style={{
                  padding: "10px 20px",
                  fontSize: "14px",
                  background: "#dc3545",
                  color: "white",
                  border: "none",
                  borderRadius: "6px",
                  cursor: "pointer",
                  fontWeight: "500",
                }}
              >
                Close
              </button>
            </div>
            <div
              style={{
                flex: 1,
                minHeight: 0,
                position: "relative",
                width: "100%",
                backgroundColor: "#000",
              }}
            >
              <iframe
                src={getPlayerIframeUrl(
                  expandedStream.url,
                  expandedStream.width,
                  expandedStream.height
                )}
                title={expandedStream.label}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  width: "100%",
                  height: "100%",
                  border: "none",
                }}
                allow="autoplay; fullscreen"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StreamingpanelPage;
