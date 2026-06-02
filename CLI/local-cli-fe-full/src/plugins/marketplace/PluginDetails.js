import React, { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Divider from "@mui/material/Divider";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import { FaCircle } from "react-icons/fa";

const PluginDetailsView = ({
  selectedPlugin,
  closeModalCallback,
  installed = null,
  enabled = false,
  onInstall,
  onEnabledStateChange,
  onUninstall,
  onTriggerMetrics,
  updateInfo = null,
  onUpdate,
  updateInProgress = false,
  installBusy = false,
  installStatusText = "",
}) => {
  const [readmeContent, setReadmeContent] = useState(null);
  const [anchorEl, setAnchorEl] = useState(null);
  const menuOpen = Boolean(anchorEl);

  const handleMenuOpen = (e) => {
    e.stopPropagation();
    setAnchorEl(e.currentTarget);
  };
  const handleMenuClose = () => setAnchorEl(null);

  useEffect(() => {
    if (!selectedPlugin?.readme_link) return;

    setReadmeContent(null);

    fetch(selectedPlugin.readme_link)
      .then((res) => res.text())
      .then(setReadmeContent)
      .catch((e) => {
        console.error(
          `Failed fetching readme from ${selectedPlugin.readme_link}`,
          e,
        );
      });
  }, [selectedPlugin.readme_link]);

  return (
    <div
      style={{
        padding: "32px",
        backgroundColor: "white",
        position: "relative",
        height: "100%",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <button
        onClick={closeModalCallback}
        style={{
          position: "absolute",
          top: "16px",
          right: "16px",
          background: "#fee2e2",
          border: "none",
          borderRadius: "50%",
          width: "32px",
          height: "32px",
          color: "#dc2626",
          fontWeight: "700",
          fontSize: "14px",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 10,
        }}
      >
        ✕
      </button>

      <div
        style={{
          flex: 1,
          overflowY: "auto",
          scrollbarWidth: "none",
          msOverflowStyle: "none",
          paddingRight: "4px",
        }}
      >
        <style>{`::-webkit-scrollbar { display: none; }`}</style>

        <div style={{ display: "flex", gap: "40px" }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
            <div
              style={{
                display: "flex",
                gap: "20px",
                alignItems: "center",
                marginBottom: "24px",
              }}
            >
              {selectedPlugin.thumbnail ? (
                <img
                  src={selectedPlugin.thumbnail}
                  style={{
                    width: "90px",
                    height: "90px",
                    borderRadius: "20px",
                    objectFit: "cover",
                    boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                  }}
                  alt=""
                />
              ) : (
                <div
                  style={{
                    width: "90px",
                    height: "90px",
                    borderRadius: "20px",
                    background: "#e5e7eb",
                    color: "#6b7280",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: "700",
                    fontSize: "14px",
                  }}
                  aria-hidden
                >
                  Plugin
                </div>
              )}
              <div>
                <h2
                  style={{
                    margin: "0 0 4px",
                    fontSize: "24px",
                    fontWeight: "800",
                    color: "#111827",
                  }}
                >
                  {selectedPlugin.core.name}
                </h2>
                <span
                  style={{
                    fontSize: "13px",
                    color: "#6b7280",
                    fontWeight: "500",
                  }}
                >
                  {selectedPlugin.core.slug}
                </span>
              </div>
            </div>

            <div style={{ display: "flex", gap: "24px", marginBottom: "28px" }}>
              <div
                style={{
                  backgroundColor: "#f9fafb",
                  borderRadius: "14px",
                  padding: "14px 20px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "4px",
                }}
              >
                <span
                  style={{
                    fontSize: "12px",
                    color: "#9ca3af",
                    fontWeight: "500",
                  }}
                >
                  VERSION
                </span>
                <span
                  style={{
                    fontSize: "15px",
                    fontWeight: "700",
                    color: "#111827",
                  }}
                >
                  v{selectedPlugin.core.version}
                </span>
              </div>
              {selectedPlugin.downloadCount && (
                <div
                  style={{
                    backgroundColor: "#f9fafb",
                    borderRadius: "14px",
                    padding: "14px 20px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "4px",
                  }}
                >
                  <span
                    style={{
                      fontSize: "12px",
                      color: "#9ca3af",
                      fontWeight: "500",
                    }}
                  >
                    DOWNLOADS
                  </span>
                  <span
                    style={{
                      fontSize: "15px",
                      fontWeight: "700",
                      color: "#111827",
                    }}
                  >
                    {selectedPlugin.downloadCount.toLocaleString()}
                  </span>
                </div>
              )}
            </div>

            <p
              style={{
                color: "#6b7280",
                lineHeight: 1.7,
                fontSize: "15px",
                margin: 0,
              }}
            >
              {selectedPlugin.core.description}
            </p>
          </div>

          <div
            style={{
              width: "200px",
              flexShrink: 0,
              display: "flex",
              flexDirection: "column",
              gap: "8px",
              paddingTop: "4px",
            }}
          >
            <p
              style={{
                margin: "0 0 8px",
                fontSize: "12px",
                fontWeight: "700",
                color: "#9ca3af",
                letterSpacing: "0.05em",
              }}
            >
              LINKS
            </p>
            {[
              {
                label: "📦 Repository",
                href: selectedPlugin.repository_link || "#",
              },
              { label: "🐛 Report a Bug", href: selectedPlugin.bugLink || "#" },
            ].map((link) => (
              <a
                key={link.label}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "block",
                  padding: "10px 14px",
                  borderRadius: "12px",
                  backgroundColor: "#f9fafb",
                  color: "#374151",
                  fontSize: "13px",
                  fontWeight: "500",
                  textDecoration: "none",
                  border: "1px solid #f3f4f6",
                }}
              >
                {link.label}
              </a>
            ))}
          </div>
        </div>

        {readmeContent && (
          <>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                margin: "32px 0 24px",
              }}
            >
              <div
                style={{ flex: 1, height: "1px", backgroundColor: "#e5e7eb" }}
              />
              <span
                style={{
                  fontSize: "11px",
                  fontWeight: "700",
                  color: "#9ca3af",
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                }}
              >
                README
              </span>
              <div
                style={{ flex: 1, height: "1px", backgroundColor: "#e5e7eb" }}
              />
            </div>

            <div
              className="markdown-body"
              style={{ fontSize: "14px", color: "#374151", lineHeight: 1.7 }}
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {readmeContent}
              </ReactMarkdown>
            </div>
          </>
        )}
      </div>

      <div
        style={{
          paddingTop: "16px",
          borderTop: "1px solid #f3f4f6",
          marginTop: "8px",
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          gap: "12px",
        }}
      >
        {!installed ? (
          <button
            type="button"
            onClick={() => onInstall?.()}
            disabled={installBusy || !onInstall}
            style={{
              width: "100%",
              padding: "14px",
              border: "none",
              backgroundColor: installBusy ? "#93c5fd" : "#3b82f6",
              color: "white",
              borderRadius: "14px",
              fontWeight: "700",
              fontSize: "15px",
              cursor:
                installBusy || !onInstall ? "not-allowed" : "pointer",
              letterSpacing: "-0.2px",
              transition: "background-color 0.2s",
            }}
          >
            {installBusy
              ? installStatusText || "Installing…"
              : "Install plugin"}
          </button>
        ) : (
          <>
            {updateInfo && onUpdate && (
              <div className="mp-plugin-update-row">
                <div className="mp-plugin-update-meta">
                  Update available: installed v{updateInfo.installedVersion} →
                  registry v{updateInfo.latestVersion}
                </div>
                <button
                  type="button"
                  className="mp-plugin-update-btn"
                  disabled={updateInProgress}
                  onClick={() => onUpdate()}
                >
                  {updateInProgress
                    ? "Updating…"
                    : `Update to v${updateInfo.latestVersion}`}
                </button>
              </div>
            )}
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                borderRadius: "999px",
                border: "1px solid #e5e7eb",
                backgroundColor: "#f9fafb",
                overflow: "hidden",
                width: "100%",
              }}
            >
              <button
                type="button"
                onClick={() => onTriggerMetrics?.()}
                style={{
                  flex: 1,
                  padding: "12px 16px",
                  border: "none",
                  background: "transparent",
                  fontWeight: "600",
                  fontSize: "14px",
                  color: "#111827",
                  cursor: onTriggerMetrics ? "pointer" : "default",
                  textAlign: "left",
                  whiteSpace: "nowrap",
                }}
              >
                View logs and metrics
              </button>
              <div
                style={{
                  width: "1px",
                  height: "22px",
                  backgroundColor: "#e5e7eb",
                  flexShrink: 0,
                }}
              />
              <button
                type="button"
                onClick={handleMenuOpen}
                style={{
                  padding: "12px 14px",
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  color: "#6b7280",
                }}
              >
                <ArrowDropDownIcon />
              </button>
            </div>

            <Menu
              anchorEl={anchorEl}
              open={menuOpen}
              onClose={handleMenuClose}
              transformOrigin={{ horizontal: "right", vertical: "top" }}
              anchorOrigin={{ horizontal: "right", vertical: "bottom" }}
              slotProps={{
                paper: {
                  style: {
                    borderRadius: "14px",
                    boxShadow: "0 8px 24px rgba(0,0,0,0.10)",
                    padding: "4px",
                    marginTop: "4px",
                  },
                },
              }}
            >
              <MenuItem
                onClick={() => {
                  onEnabledStateChange?.(enabled);
                  handleMenuClose();
                }}
                style={{
                  borderRadius: "10px",
                  fontSize: "13px",
                  fontWeight: "600",
                }}
              >
                <span style={{ marginRight: "10px" }}>
                  <FaCircle color={enabled ? "red" : "green"} />
                </span>
                {enabled ? "Disable" : "Enable"}
              </MenuItem>

              <Divider style={{ margin: "4px 0" }} />

              <MenuItem
                onClick={() => {
                  onUninstall?.();
                  handleMenuClose();
                }}
                style={{
                  borderRadius: "10px",
                  fontSize: "13px",
                  fontWeight: "600",
                  color: "#dc2626",
                }}
              >
                <span style={{ marginRight: "10px" }}>🗑️</span>
                Uninstall
              </MenuItem>
            </Menu>
          </>
        )}
      </div>
    </div>
  );
};

export default PluginDetailsView;
