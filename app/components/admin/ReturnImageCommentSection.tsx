/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import type { ReturnImageCommentConfig } from "../../services/settings.server";

type ReturnImageCommentSectionProps = {
  config: ReturnImageCommentConfig;
};

export function ReturnImageCommentSection({ config }: ReturnImageCommentSectionProps) {
  const fetcher = useFetcher<any>();
  let shopify: any = null;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    shopify = useAppBridge();
  } catch {
    // Fallback if outside App Bridge
  }

  useEffect(() => {
    if (fetcher.data?.message && shopify?.toast?.show) {
      shopify.toast.show(fetcher.data.message);
    }
  }, [fetcher.data, shopify]);

  const [enabled, setEnabled] = useState(config.enabled);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [imageUploadMode, setImageUploadMode] = useState<"optional" | "mandatory" | "disabled">(
    config.imageUploadMode || "optional"
  );
  const [maxPhotos, setMaxPhotos] = useState<number>(config.maxPhotos || 1);
  const [includeInstructions, setIncludeInstructions] = useState<boolean>(config.includeInstructions || false);
  const [instructions, setInstructions] = useState<string>(config.instructions || "");
  const [commentMode, setCommentMode] = useState<"optional" | "mandatory" | "disabled">(
    config.commentMode || "optional"
  );

  // Sync state if config prop updates
  useEffect(() => {
    setEnabled(config.enabled);
    setImageUploadMode(config.imageUploadMode || "optional");
    setMaxPhotos(config.maxPhotos || 1);
    setIncludeInstructions(config.includeInstructions || false);
    setInstructions(config.instructions || "");
    setCommentMode(config.commentMode || "optional");
  }, [config]);

  const handleToggle = (nextVal: boolean) => {
    setEnabled(nextVal);
    fetcher.submit(
      {
        _action: "save_return_image_comment_config",
        enabled: String(nextVal),
        imageUploadMode,
        maxPhotos: String(maxPhotos),
        includeInstructions: includeInstructions ? "on" : "off",
        instructions,
        commentMode,
      },
      { method: "post" }
    );
  };

  const handleSave = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    fetcher.submit(
      {
        _action: "save_return_image_comment_config",
        enabled: String(enabled),
        imageUploadMode,
        maxPhotos: String(maxPhotos),
        includeInstructions: includeInstructions ? "on" : "off",
        instructions,
        commentMode,
      },
      { method: "post" }
    );
  };

  return (
    <div className="returbo-card" style={{ marginBottom: 24 }}>
      {/* Top Toggle Switch */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={() => handleToggle(!enabled)}
          style={{
            width: 44,
            height: 24,
            borderRadius: 24,
            background: enabled ? "var(--returbo-pink)" : "#e5e7eb",
            border: "none",
            cursor: "pointer",
            position: "relative",
            padding: 0,
            transition: "background-color 0.2s",
          }}
        >
          <span
            style={{
              width: 20,
              height: 20,
              borderRadius: "50%",
              background: "#ffffff",
              position: "absolute",
              top: 2,
              left: enabled ? 22 : 2,
              transition: "left 0.2s",
              boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
            }}
          />
        </button>
        <span style={{ fontSize: 13, color: "#111827" }}>
          Function is turned <strong>{enabled ? "ON" : "OFF"}</strong>
        </span>
      </div>

      {/* Header Title & Subtitle */}
      <div className="returbo-card-header" style={{ borderBottom: "none", paddingBottom: 0, marginBottom: 12 }}>
        <h2 className="returbo-card-title" style={{ fontSize: 20, fontWeight: 700, margin: "0 0 6px 0", color: "#111827" }}>
          Returns: Attach image and comment options
        </h2>
        <p className="returbo-card-subtitle" style={{ fontSize: 13, color: "#6b7280", margin: 0, lineHeight: 1.5, maxWidth: 740 }}>
          Ask your customers to upload an image of the return. This is a great option if you want to pre-check the item before they send it back.
        </p>
      </div>

      {/* Collapse / Expand Toggle */}
      <div style={{ marginBottom: 18 }}>
        <button
          type="button"
          onClick={() => setIsCollapsed((v) => !v)}
          style={{
            background: "none",
            border: "none",
            padding: 0,
            color: "var(--returbo-pink)",
            fontSize: 13,
            fontWeight: 500,
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          <span>{isCollapsed ? "Expand to show configuration" : "Collapse to hide configuration"}</span>
          <span style={{ fontSize: 11 }}>{isCollapsed ? "⌄" : "⌃"}</span>
        </button>
      </div>

      {/* Configuration Form */}
      {!isCollapsed && (
        <form onSubmit={handleSave} style={{ borderTop: "1px solid #f3f4f6", paddingTop: 18 }}>
          {/* Section 1: Upload image */}
          <div style={{ marginBottom: 24 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 4px 0", color: "#111827" }}>
              Upload image
            </h3>
            <p style={{ fontSize: 12, color: "#6b7280", margin: "0 0 14px 0" }}>
              Choose whether it is optional or mandatory for a customer to upload an image and if so, how many of them for each return.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#374151", cursor: "pointer" }}>
                <input
                  type="radio"
                  name="imageUploadMode"
                  value="optional"
                  checked={imageUploadMode === "optional"}
                  onChange={() => setImageUploadMode("optional")}
                  style={{ accentColor: "var(--returbo-pink)", width: 16, height: 16 }}
                />
                <span>Make it <strong>optional</strong> for a customer to upload a picture of the item</span>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#374151", cursor: "pointer" }}>
                <input
                  type="radio"
                  name="imageUploadMode"
                  value="mandatory"
                  checked={imageUploadMode === "mandatory"}
                  onChange={() => setImageUploadMode("mandatory")}
                  style={{ accentColor: "var(--returbo-pink)", width: 16, height: 16 }}
                />
                <span>Make it <strong>mandatory</strong> for a customer to upload a picture of the item</span>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#374151", cursor: "pointer" }}>
                <input
                  type="radio"
                  name="imageUploadMode"
                  value="disabled"
                  checked={imageUploadMode === "disabled"}
                  onChange={() => setImageUploadMode("disabled")}
                  style={{ accentColor: "var(--returbo-pink)", width: 16, height: 16 }}
                />
                <span><strong>DON'T allow</strong> a customer to upload a picture of a returned item</span>
              </label>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: "#111827" }}>Customer can upload</span>
              <select
                name="maxPhotos"
                value={maxPhotos}
                onChange={(e) => setMaxPhotos(Number(e.target.value))}
                style={{
                  padding: "6px 28px 6px 12px",
                  borderRadius: 6,
                  border: "1px solid #d1d5db",
                  background: "#ffffff",
                  fontSize: 13,
                  color: "#374151",
                  cursor: "pointer",
                }}
              >
                <option value={1}>1 photo</option>
                <option value={2}>2 photos</option>
                <option value={3}>3 photos</option>
                <option value={4}>4 photos</option>
                <option value={5}>5 photos</option>
              </select>
            </div>
          </div>

          {/* Section 2: Image instructions */}
          <div style={{ marginBottom: 24 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 4px 0", color: "#111827" }}>
              Image instructions
            </h3>
            <p style={{ fontSize: 12, color: "#6b7280", margin: "0 0 14px 0" }}>
              Here you can include additional instructions for how the customers should take a picture of the item.
            </p>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#374151", cursor: "pointer", marginBottom: 14 }}>
              <input
                type="checkbox"
                name="includeInstructions"
                checked={includeInstructions}
                onChange={(e) => setIncludeInstructions(e.target.checked)}
                style={{ accentColor: "var(--returbo-pink)", width: 16, height: 16 }}
              />
              <span>Include instructions for the image that will appear to the customer</span>
            </label>

            <div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#111827", marginBottom: 6 }}>
                Instructions
              </label>
              <input
                type="text"
                name="instructions"
                maxLength={60}
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder="e.g. We need the photo of the sides and the front."
                className="returbo-detail-input"
                style={{
                  width: "100%",
                  maxWidth: 520,
                  background: "#f9fafb",
                }}
              />
              <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 4 }}>
                Please keep it to 60 characters. Visible to the customer.
              </div>
            </div>
          </div>

          {/* Section 3: Comment on returned item */}
          <div style={{ marginBottom: 24 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 4px 0", color: "#111827" }}>
              Comment on returned item
            </h3>
            <p style={{ fontSize: 12, color: "#6b7280", margin: "0 0 14px 0" }}>
              Choose whether you want to make it optional or mandatory for a customer to write a comment about an item they are returning.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#374151", cursor: "pointer" }}>
                <input
                  type="radio"
                  name="commentMode"
                  value="optional"
                  checked={commentMode === "optional"}
                  onChange={() => setCommentMode("optional")}
                  style={{ accentColor: "var(--returbo-pink)", width: 16, height: 16 }}
                />
                <span>Make it <strong>optional</strong> for a customer to write a short summary about the item</span>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#374151", cursor: "pointer" }}>
                <input
                  type="radio"
                  name="commentMode"
                  value="mandatory"
                  checked={commentMode === "mandatory"}
                  onChange={() => setCommentMode("mandatory")}
                  style={{ accentColor: "var(--returbo-pink)", width: 16, height: 16 }}
                />
                <span>Make it <strong>mandatory</strong> for a customer to write a short summary about the item</span>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#374151", cursor: "pointer" }}>
                <input
                  type="radio"
                  name="commentMode"
                  value="disabled"
                  checked={commentMode === "disabled"}
                  onChange={() => setCommentMode("disabled")}
                  style={{ accentColor: "var(--returbo-pink)", width: 16, height: 16 }}
                />
                <span><strong>DON'T allow</strong> a customer to write a short summary</span>
              </label>
            </div>
          </div>

          {/* Bottom Save Action */}
          <div style={{ display: "flex", justifyContent: "flex-end", borderTop: "1px solid #f3f4f6", paddingTop: 16 }}>
            <button
              type="submit"
              className="returbo-btn-primary"
            >
              Save configuration
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

