import { useState } from "react";

interface EmailPreviewProps {
  subject: string;
  html: string;
  from?: string;
  title?: string;
}

/** Inbox-style preview of a rendered email, with a desktop / mobile width toggle. */
export function EmailPreview({ subject, html, from, title = "Preview" }: EmailPreviewProps) {
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");

  const toggleStyle = (active: boolean): React.CSSProperties => ({
    border: "1px solid #d1d5db",
    background: active ? "#111827" : "#ffffff",
    color: active ? "#ffffff" : "#374151",
    borderRadius: 6,
    padding: "4px 10px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  });

  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden", background: "#ffffff", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "10px 14px", borderBottom: "1px solid #f1f5f9", background: "#f9fafb" }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>{title}</span>
        <div style={{ display: "flex", gap: 6 }} role="group" aria-label="Preview width">
          <button type="button" style={toggleStyle(device === "desktop")} aria-pressed={device === "desktop"} onClick={() => setDevice("desktop")}>
            Desktop
          </button>
          <button type="button" style={toggleStyle(device === "mobile")} aria-pressed={device === "mobile"} onClick={() => setDevice("mobile")}>
            Mobile
          </button>
        </div>
      </div>
      <div style={{ padding: "12px 14px", borderBottom: "1px solid #f1f5f9", fontSize: 13, color: "#374151", display: "grid", gap: 4 }}>
        {from && (
          <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            <span style={{ color: "#6b7280" }}>From: </span>{from}
          </div>
        )}
        <div style={{ fontWeight: 600, color: "#111827", overflowWrap: "anywhere" }}>
          <span style={{ color: "#6b7280", fontWeight: 400 }}>Subject: </span>{subject || "(no subject)"}
        </div>
      </div>
      <div style={{ background: "#f3f4f6", display: "flex", justifyContent: "center", padding: device === "mobile" ? "12px 0" : 0 }}>
        <iframe
          title={`${title}: ${subject}`}
          srcDoc={html}
          sandbox=""
          style={{
            display: "block",
            width: device === "mobile" ? 375 : "100%",
            maxWidth: "100%",
            height: 560,
            border: 0,
            background: "#f3f4f6",
          }}
        />
      </div>
    </div>
  );
}

export default EmailPreview;
