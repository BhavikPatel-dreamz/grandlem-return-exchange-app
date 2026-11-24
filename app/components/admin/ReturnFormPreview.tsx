import React, { useState } from "react";

export type ReturnFormPreviewProps = {
  primaryColor: string;
  primaryTextColor: string;
  textColor: string;
  secondaryBgColor: string;
  showLogo: boolean;
  showStoreName: boolean;
  logoUrl?: string;
  storeName?: string;
};

export function ReturnFormPreview({
  primaryColor,
  primaryTextColor,
  textColor,
  secondaryBgColor,
  showLogo,
  showStoreName,
  logoUrl,
  storeName = "Grand Le Mar",
}: ReturnFormPreviewProps) {
  const [selectedType, setSelectedType] = useState<"return" | "exchange" | "complaint">("exchange");
  const [selectedItems, setSelectedItems] = useState({ jacket: true, shirt: false });
  const [comment, setComment] = useState("");

  const toggleItem = (key: "jacket" | "shirt") => {
    setSelectedItems((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="returbo-customer-preview-container" style={{ width: "100%", maxWidth: 520 }}>
      {/* Mock Browser Window Frame */}
      <div
        style={{
          background: "#ffffff",
          border: "1px solid #e2e8f0",
          borderRadius: 12,
          overflow: "hidden",
          boxShadow: "0 4px 24px rgba(15, 23, 42, 0.06)",
        }}
      >
        {/* Browser Topbar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 14px",
            background: "#f8fafc",
            borderBottom: "1px solid #e2e8f0",
          }}
        >
          <div style={{ display: "flex", gap: 5 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#f87171" }} />
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#fbbf24" }} />
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#34d399" }} />
          </div>
          <div
            style={{
              flex: 1,
              background: "#ffffff",
              borderRadius: 4,
              padding: "2px 8px",
              fontSize: 10.5,
              color: "#64748b",
              fontFamily: "monospace",
              textAlign: "center",
              border: "1px solid #e2e8f0",
              margin: "0 10px",
            }}
          >
            storefront / returns
          </div>
          <span
            style={{
              fontSize: 9.5,
              fontWeight: 700,
              color: "#94a3b8",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            Live Preview
          </span>
        </div>

        {/* Storefront Viewport */}
        <div
          style={{
            padding: "14px 14px 16px",
            background: "#ffffff",
            boxSizing: "border-box",
            textAlign: "left",
          }}
        >
          {/* Brand Header */}
          {(showLogo || showStoreName) && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 8,
              }}
            >
              {showLogo && (
                logoUrl ? (
                  <img
                    src={logoUrl}
                    alt="Store logo"
                    style={{ maxHeight: 28, maxWidth: 90, objectFit: "contain", borderRadius: 4 }}
                  />
                ) : (
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 4,
                      background: "#000000",
                      color: "#ffffff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: 800,
                      fontSize: 10.5,
                      letterSpacing: "0.04em",
                      flexShrink: 0,
                    }}
                  >
                    GLM
                  </div>
                )
              )}
              {showStoreName && (
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: primaryTextColor,
                    letterSpacing: "-0.01em",
                  }}
                >
                  {storeName || "Grand Le Mar"}
                </span>
              )}
            </div>
          )}

          {/* Form Header */}
          <div style={{ marginBottom: 10 }}>
            <h2
              style={{
                fontSize: 18,
                fontWeight: 800,
                color: primaryTextColor,
                margin: "0 0 2px 0",
                letterSpacing: "-0.02em",
                lineHeight: 1.2,
                fontFamily: "inherit",
              }}
            >
              Returns &amp; exchanges
            </h2>
            <p style={{ fontSize: 11, color: "#64748b", margin: 0, lineHeight: 1.35 }}>
              Start a return, exchange, or complaint for an order.
            </p>
          </div>

          {/* Order Found Card */}
          <div
            style={{
              background: "#ffffff",
              border: "1px solid #e5e7eb",
              borderRadius: 8,
              padding: "12px 12px 14px",
              boxShadow: "0 1px 2px rgba(0,0,0,0.02)",
            }}
          >
            <h3
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: primaryTextColor,
                margin: "0 0 8px 0",
                fontFamily: "inherit",
              }}
            >
              Order found
            </h3>

            {/* Meta row */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 14,
                marginBottom: 10,
                fontSize: 11,
                lineHeight: 1.3,
              }}
            >
              <div>
                <span style={{ color: "#64748b" }}>Order </span>
                <strong style={{ color: primaryTextColor }}>#1026</strong>
              </div>
              <div>
                <span style={{ color: "#64748b" }}>Purchase date </span>
                <strong style={{ color: primaryTextColor }}>23 Nov 2026</strong>
              </div>
              <div>
                <span style={{ color: "#64748b" }}>Deadline </span>
                <strong style={{ color: primaryTextColor }}>23 Nov 2026</strong>
              </div>
            </div>

            {/* Product Items */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
              {/* Product 1: Jacket */}
              <div
                onClick={() => toggleItem("jacket")}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  border: "1px solid #e5e7eb",
                  borderRadius: 6,
                  padding: "6px 10px",
                  background: "#ffffff",
                  cursor: "pointer",
                }}
              >
                <div
                  style={{
                    width: 15,
                    height: 15,
                    borderRadius: 3,
                    background: selectedItems.jacket ? primaryColor : "#ffffff",
                    border: selectedItems.jacket ? `1.5px solid ${primaryColor}` : "1.5px solid #d1d5db",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    transition: "all 0.15s ease",
                  }}
                >
                  {selectedItems.jacket && (
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke={textColor || "#ffffff"} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </div>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 5,
                    overflow: "hidden",
                    background: "#fdf2f4",
                    border: "1px solid #fce7ec",
                    flexShrink: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <svg width="28" height="28" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M19 14L25 21L28 17L31 21L37 14L44 19L40 43H16L12 19L19 14Z" fill="#e798a6" stroke="#c97384" strokeWidth="1.5" strokeLinejoin="round"/>
                    <path d="M28 17V43" stroke="#c97384" strokeWidth="1.5" strokeDasharray="2 2"/>
                    <path d="M25 21L28 24L31 21" stroke="#a8495c" strokeWidth="1.5"/>
                    <circle cx="28" cy="29" r="1.5" fill="#a8495c"/>
                    <circle cx="28" cy="35" r="1.5" fill="#a8495c"/>
                    <path d="M16 23L19 41" stroke="#d68292" strokeWidth="1.2"/>
                    <path d="M40 23L37 41" stroke="#d68292" strokeWidth="1.2"/>
                  </svg>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 1, flex: 1 }}>
                  <strong style={{ fontSize: 12, fontWeight: 600, color: primaryTextColor }}>Jacket</strong>
                  <span style={{ fontSize: 10.5, color: "#64748b" }}>Qty: 1</span>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: primaryTextColor }}>400.00</span>
                </div>
              </div>

              {/* Product 2: Blue Cotton Shirt */}
              <div
                onClick={() => toggleItem("shirt")}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  border: "1px solid #e5e7eb",
                  borderRadius: 6,
                  padding: "6px 10px",
                  background: "#ffffff",
                  cursor: "pointer",
                }}
              >
                <div
                  style={{
                    width: 15,
                    height: 15,
                    borderRadius: 3,
                    background: selectedItems.shirt ? primaryColor : "#ffffff",
                    border: selectedItems.shirt ? `1.5px solid ${primaryColor}` : "1.5px solid #d1d5db",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    transition: "all 0.15s ease",
                  }}
                >
                  {selectedItems.shirt && (
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke={textColor || "#ffffff"} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </div>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 5,
                    overflow: "hidden",
                    background: "#eff6ff",
                    border: "1px solid #dbeafe",
                    flexShrink: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <svg width="28" height="28" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M18 15L24 20L28 16L32 20L38 15L45 20L41 43H15L11 20L18 15Z" fill="#93c5fd" stroke="#3b82f6" strokeWidth="1.5" strokeLinejoin="round"/>
                    <path d="M28 16V43" stroke="#3b82f6" strokeWidth="1.5"/>
                    <path d="M24 20L28 23L32 20" stroke="#1d4ed8" strokeWidth="1.5"/>
                    <circle cx="28" cy="27" r="1.5" fill="#1d4ed8"/>
                    <circle cx="28" cy="33" r="1.5" fill="#1d4ed8"/>
                    <circle cx="28" cy="39" r="1.5" fill="#1d4ed8"/>
                  </svg>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 1, flex: 1 }}>
                  <strong style={{ fontSize: 12, fontWeight: 600, color: primaryTextColor }}>Blue Cotton Shirt</strong>
                  <span style={{ fontSize: 10.5, color: "#64748b" }}>Qty: 1</span>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: primaryTextColor }}>300.00</span>
                </div>
              </div>
            </div>

            {/* Deadline banner */}
            <div
              style={{
                background: secondaryBgColor,
                border: `1px solid ${secondaryBgColor.toLowerCase() === "#ffffff" ? "#e5e7eb" : primaryColor + "35"}`,
                borderRadius: 6,
                padding: "5px 8px",
                marginBottom: 10,
                display: "flex",
                alignItems: "center",
                gap: 7,
                color: primaryColor,
                fontSize: 11,
                fontWeight: 500,
              }}
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke={primaryColor}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ flexShrink: 0 }}
              >
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              <span>
                You have until <strong>23 Nov 2026</strong> to request a return or exchange (0 days).
              </span>
            </div>

            {/* What would you like to do with this order? */}
            <div
              style={{
                fontSize: 11.5,
                fontWeight: 700,
                color: primaryTextColor,
                marginBottom: 6,
              }}
            >
              What would you like to do with this order?
            </div>

            {/* 3 Type cards */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: 6,
                marginBottom: 10,
              }}
            >
              {/* Return Card */}
              <div
                onClick={() => setSelectedType("return")}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  gap: 6,
                  padding: "8px 6px",
                  border: selectedType === "return" ? `1.5px solid ${primaryColor}` : "1px solid #e5e7eb",
                  borderRadius: 6,
                  background: selectedType === "return" ? secondaryBgColor : "#ffffff",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                  boxSizing: "border-box",
                }}
              >
                <div style={{ width: 16, height: 16, display: "flex", alignItems: "center" }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#111827" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                    <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                    <line x1="12" y1="22.08" x2="12" y2="12" />
                  </svg>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: primaryTextColor }}>Return</span>
                  <span style={{ fontSize: 9.5, color: "#64748b", lineHeight: 1.3 }}>Send items back for a refund.</span>
                </div>
              </div>

              {/* Exchange Card */}
              <div
                onClick={() => setSelectedType("exchange")}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  gap: 6,
                  padding: "8px 6px",
                  border: selectedType === "exchange" ? `1.5px solid ${primaryColor}` : "1px solid #e5e7eb",
                  borderRadius: 6,
                  background: selectedType === "exchange" ? secondaryBgColor : "#ffffff",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                  boxSizing: "border-box",
                }}
              >
                <div style={{ width: 16, height: 16, display: "flex", alignItems: "center" }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#111827" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 8h14M14 4l4 4-4 4M20 16H6M10 12l-4 4 4 4" />
                  </svg>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: primaryTextColor }}>Exchange</span>
                  <span style={{ fontSize: 9.5, color: "#64748b", lineHeight: 1.3 }}>Replace with a different size, color, or item.</span>
                </div>
              </div>

              {/* Complaint Card */}
              <div
                onClick={() => setSelectedType("complaint")}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  gap: 6,
                  padding: "8px 6px",
                  border: selectedType === "complaint" ? `1.5px solid ${primaryColor}` : "1px solid #e5e7eb",
                  borderRadius: 6,
                  background: selectedType === "complaint" ? secondaryBgColor : "#ffffff",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                  boxSizing: "border-box",
                }}
              >
                <div style={{ width: 16, height: 16, display: "flex", alignItems: "center" }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#111827" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: primaryTextColor }}>Complaint</span>
                  <span style={{ fontSize: 9.5, color: "#64748b", lineHeight: 1.3 }}>Report an issue with this order.</span>
                </div>
              </div>
            </div>

            {/* Comment field */}
            <div style={{ marginBottom: 8 }}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: primaryTextColor, marginBottom: 3 }}>
                Comment
              </label>
              <div style={{ position: "relative" }}>
                <textarea
                  rows={2}
                  maxLength={500}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Describe the problem (at least 3 characters)."
                  style={{
                    width: "100%",
                    minHeight: 44,
                    border: "1px solid #e5e7eb",
                    borderRadius: 6,
                    padding: "6px 8px",
                    fontSize: 11,
                    color: primaryTextColor,
                    boxSizing: "border-box",
                    outline: "none",
                    fontFamily: "inherit",
                  }}
                />
              </div>
              <div style={{ textAlign: "right", fontSize: 9.5, color: "#9ca3af", marginTop: 1 }}>
                {comment.length} / 500
              </div>
            </div>

            {/* Photos block */}
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: primaryTextColor, marginBottom: 3 }}>
                Photos
              </label>
              <div
                style={{
                  border: "1px dashed #d1d5db",
                  borderRadius: 6,
                  padding: "6px 10px",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  background: "#ffffff",
                  cursor: "pointer",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21 15 16 10 5 21" />
                  </svg>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 1, flex: 1 }}>
                  <strong style={{ fontSize: 11, fontWeight: 600, color: primaryTextColor }}>Choose files or drag and drop</strong>
                  <span style={{ fontSize: 9.5, color: "#64748b" }}>Images only, up to 5 MB each. Add at least 1 photo(s).</span>
                </div>
                <button
                  type="button"
                  style={{
                    background: "#ffffff",
                    border: "1px solid #d1d5db",
                    borderRadius: 4,
                    padding: "3px 8px",
                    fontSize: 10,
                    fontWeight: 500,
                    color: primaryTextColor,
                    pointerEvents: "none",
                    flexShrink: 0,
                  }}
                >
                  Choose files
                </button>
              </div>
            </div>

            {/* Submit Request Button */}
            <div>
              <button
                type="button"
                style={{
                  background: primaryColor,
                  color: textColor,
                  border: "none",
                  borderRadius: 6,
                  height: 32,
                  padding: "0 16px",
                  fontSize: 11.5,
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  transition: "opacity 0.15s ease",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                }}
              >
                <span>Submit request</span>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={textColor} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
