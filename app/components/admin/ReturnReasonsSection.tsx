/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";

export type ReturnReasonData = {
  id: string;
  labelEn: string;
  parentLabel?: string;
  appliesTo: string;
  active: boolean;
  sortOrder: number;
};

type ReturnReasonsSectionProps = {
  reasons: ReturnReasonData[];
};

const getParentLabel = (reason: ReturnReasonData) => reason.parentLabel ?? "";

export function ReturnReasonsSection({ reasons }: ReturnReasonsSectionProps) {
  const fetcher = useFetcher<any>();
  let shopify: any = null;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    shopify = useAppBridge();
  } catch {
    // Fallback if rendered outside Shopify App Bridge provider
  }

  useEffect(() => {
    if (fetcher.data?.message && shopify?.toast?.show) {
      shopify.toast.show(fetcher.data.message);
    }
  }, [fetcher.data, shopify]);

  const [isEditing, setIsEditing] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [hideReturns, setHideReturns] = useState(false);
  const [hideComplaints, setHideComplaints] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  // Deduplicate reasons by normalized labelEn to prevent duplicate UI entries
  const uniqueReasons = reasons.filter(
    (r, idx, arr) => idx === arr.findIndex((t) =>
      t.labelEn.toLowerCase().trim() === r.labelEn.toLowerCase().trim() &&
      getParentLabel(t) === getParentLabel(r)
    )
  );

  // 3-dots dropdown menu state
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  // Sub-reason dialog state
  const [subReasonParent, setSubReasonParent] = useState<{ id: string; label: string; appliesTo: string } | null>(null);
  const [subReasonLabel, setSubReasonLabel] = useState("");

  // Update reason code dialog state
  const [codeEditReason, setCodeEditReason] = useState<{ id: string; label: string; currentCode: string } | null>(null);
  const [codeValue, setCodeValue] = useState("");

  // Custom reason creation inline state
  const [showAddReturn, setShowAddReturn] = useState(false);
  const [newReturnLabel, setNewReturnLabel] = useState("");
  const [showAddComplaint, setShowAddComplaint] = useState(false);
  const [newComplaintLabel, setNewComplaintLabel] = useState("");
  const [pendingReasonAction, setPendingReasonAction] = useState<
    "save" | "add-return" | "add-complaint" | "sub-reason" | "reason-code" | null
  >(null);

  // Close 3-dots popup on click outside
  useEffect(() => {
    const handleClickOutside = () => setOpenMenuId(null);
    if (openMenuId) {
      window.addEventListener("click", handleClickOutside);
      return () => window.removeEventListener("click", handleClickOutside);
    }
  }, [openMenuId]);

  // Local state for editing reason visibility.
  const [editState, setEditState] = useState<Record<string, { active: boolean }>>(() => {
    const map: Record<string, { active: boolean }> = {};
    for (const r of uniqueReasons) {
      map[r.id] = { active: r.active };
    }
    return map;
  });

  // Keep the editable values in sync with server data after fetcher submissions.
  useEffect(() => {
    setEditState(() => {
      const map: Record<string, { active: boolean }> = {};
      for (const r of reasons) {
        map[r.id] = { active: r.active };
      }
      return map;
    });
  }, [reasons]);

  useEffect(() => {
    if (fetcher.state !== "idle" || !pendingReasonAction || !fetcher.data) return;
    if (fetcher.data.ok) {
      if (pendingReasonAction === "save") {
        setIsEditing(false);
        setShowAddReturn(false);
        setShowAddComplaint(false);
        setSubReasonParent(null);
        setCodeEditReason(null);
      } else if (pendingReasonAction === "add-return") {
        setNewReturnLabel("");
        setShowAddReturn(false);
      } else if (pendingReasonAction === "add-complaint") {
        setNewComplaintLabel("");
        setShowAddComplaint(false);
      } else if (pendingReasonAction === "sub-reason") {
        setSubReasonParent(null);
        setSubReasonLabel("");
      } else if (pendingReasonAction === "reason-code") {
        setCodeEditReason(null);
        setCodeValue("");
      }
    }
    setPendingReasonAction(null);
  }, [fetcher.data, fetcher.state, pendingReasonAction]);

  const handleStartEdit = () => {
    const map: Record<string, { active: boolean }> = {};
    for (const r of uniqueReasons) {
      map[r.id] = { active: r.active };
    }
    setEditState(map);
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setShowAddReturn(false);
    setShowAddComplaint(false);
    setSubReasonParent(null);
    setCodeEditReason(null);
  };

  const handleSave = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    formData.set("_action", "save_return_reasons");
    setPendingReasonAction("save");
    fetcher.submit(formData, { method: "post" });
  };

  const handleArchiveReason = (reasonId: string) => {
    setOpenMenuId(null);
    setEditState((prev) => ({
      ...prev,
      [reasonId]: { active: false },
    }));
    fetcher.submit({ _action: "archive_reason", reasonId }, { method: "post" });
  };

  const handleUnarchiveReason = (reasonId: string) => {
    setEditState((prev) => ({
      ...prev,
      [reasonId]: { active: true },
    }));
    fetcher.submit({ _action: "unarchive_reason", reasonId }, { method: "post" });
  };

  const handleAddCustomReturn = () => {
    if (!newReturnLabel.trim()) return;
    setPendingReasonAction("add-return");
    fetcher.submit(
      { _action: "create_custom_reason", labelEn: newReturnLabel.trim(), appliesTo: "return,exchange" },
      { method: "post" }
    );
  };

  const handleAddCustomComplaint = () => {
    if (!newComplaintLabel.trim()) return;
    setPendingReasonAction("add-complaint");
    fetcher.submit(
      { _action: "create_custom_reason", labelEn: newComplaintLabel.trim(), appliesTo: "complaint" },
      { method: "post" }
    );
  };

  const handleSaveSubReason = (e: React.FormEvent) => {
    e.preventDefault();
    if (!subReasonParent || !subReasonLabel.trim()) return;
    setPendingReasonAction("sub-reason");
    fetcher.submit(
      {
        _action: "create_sub_reason",
        parentLabel: subReasonParent.label,
        appliesTo: subReasonParent.appliesTo,
        labelEn: subReasonLabel.trim(),
      },
      { method: "post" }
    );
  };

  const handleSaveReasonCode = (e: React.FormEvent) => {
    e.preventDefault();
    if (!codeEditReason) return;
    setPendingReasonAction("reason-code");
    fetcher.submit(
      {
        _action: "update_reason_code",
        reasonId: codeEditReason.id,
        code: codeValue.trim(),
      },
      { method: "post" }
    );
  };

  const toggleActive = (id: string, label: string) => {
    setEditState((prev) => {
      const current = prev[id]?.active ?? false;
      const nextActive = !current;
      const updated = {
        ...prev,
        [id]: {
          active: nextActive,
        },
      };

      const children = uniqueReasons.filter((reason) => getParentLabel(reason) === label);
      for (const child of children) {
        updated[child.id] = {
          active: nextActive,
        };
      }

      const reason = uniqueReasons.find((item) => item.id === id);
      const parentLabel = reason ? getParentLabel(reason) : "";
      if (parentLabel && nextActive) {
        const parent = uniqueReasons.find((item) => item.labelEn === parentLabel);
        if (parent) {
          updated[parent.id] = {
            active: true,
          };
        }
      }

      return updated;
    });
  };

  // Split into return reasons and complaints
  const returnReasons = uniqueReasons.filter((r) => r.appliesTo.includes("return") || r.appliesTo.includes("exchange"));
  const complaintReasons = uniqueReasons.filter((r) => r.appliesTo.includes("complaint"));

  // Effective reason state (combines server props with local state for zero-latency UI updates)
  const effectiveReasons = uniqueReasons.map((r) => {
    const edit = editState[r.id];
    if (!edit) return r;
    return { ...r, active: edit.active };
  });

  const activeReturnReasons = effectiveReasons.filter(
    (r) => r.active && (r.appliesTo.includes("return") || r.appliesTo.includes("exchange"))
  );
  const archivedReasons = effectiveReasons.filter((r) => !r.active);

  return (
    <div className="returbo-card" style={{ marginBottom: 24, position: "relative" }}>
      {/* Card Header with Checkmark */}
      <div
        className="returbo-card-header"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          borderBottom: "none",
          paddingBottom: 0,
          marginBottom: 12,
        }}
      >
        <div>
          <h2 className="returbo-card-title" style={{ fontSize: 22, margin: "0 0 6px 0" }}>
            Return reasons
          </h2>
          <p className="returbo-card-subtitle" style={{ maxWidth: 740, fontSize: 13, lineHeight: 1.5 }}>
            Choose which return reasons you would like your customers to select from. This is important as this will
            allow us to collect return data for you. Please also select if you would like to restock items that are
            being returned
          </p>
        </div>
      </div>

      {/* Collapse / Expand Toggle */}
      <div style={{ marginBottom: 16 }}>
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
          <span>{isCollapsed ? "Expand to show the full list" : "Collapse to hide the full list"}</span>
          <span style={{ fontSize: 11 }}>{isCollapsed ? "⌄" : "⌃"}</span>
        </button>
      </div>

      {!isCollapsed && (
        <>
          {/* =========================================================================
              VIEW MODE
             ========================================================================= */}
          {!isEditing ? (
            <div>
              {/* Restock Options Radio Buttons */}
              <div style={{ marginBottom: 22, paddingBottom: 18, borderBottom: "1px solid #f3f4f6" }}>
                <h3 style={{ fontSize: 14, fontWeight: 700, color: "#111827", margin: "0 0 4px 0" }}>
                  Restock options
                </h3>
                <p style={{ fontSize: 12, color: "#6b7280", margin: "0 0 12px 0" }}>
                  Manually decide whether to restock items during quality checks. Complaints will never be restocked.
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#374151", cursor: "pointer" }}>
                    <input
                      type="radio"
                      name="restockOptionView"
                      defaultChecked
                      style={{ accentColor: "var(--returbo-pink)", width: 16, height: 16 }}
                    />
                    <span>
                      Manually decide to restock or not restock items during the quality check in{" "}
                      <strong>Pending for Approval</strong> stage
                    </span>
                  </label>
                </div>
              </div>

              {/* Language Selector */}
              <div style={{ marginBottom: 18 }}>
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 12px",
                    borderRadius: 8,
                    border: "1px solid #e5e7eb",
                    background: "#ffffff",
                    fontSize: 13,
                    color: "#374151",
                    fontWeight: 500,
                  }}
                >
                  <span>🇺🇸 English (US)</span>
                  <span style={{ fontSize: 10, color: "#9ca3af" }}>▼</span>
                </div>
              </div>

              {/* Returns Section Header */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  marginBottom: 12,
                  paddingBottom: 8,
                  borderBottom: "1px solid #f3f4f6",
                }}
              >
                <h3 style={{ fontSize: 16, fontWeight: 700, color: "#111827", margin: 0 }}>Returns</h3>
                <button
                  type="button"
                  onClick={() => setHideReturns((v) => !v)}
                  style={{
                    background: "#ffffff",
                    border: "1px solid #e5e7eb",
                    borderRadius: 6,
                    padding: "3px 10px",
                    fontSize: 12,
                    fontWeight: 500,
                    color: "#4b5563",
                    cursor: "pointer",
                  }}
                >
                  {hideReturns ? "Show reasons" : "Hide reasons"}
                </button>
              </div>

              {/* Returns Reason List (View Mode) */}
              {!hideReturns && (
                <div style={{ display: "flex", flexDirection: "column", gap: 0, marginBottom: 20 }}>
                  {activeReturnReasons.map((r) => {
                    const isChild = Boolean(getParentLabel(r));
                    const isParent = activeReturnReasons.some((child) => getParentLabel(child) === r.labelEn);
                    return (
                      <div
                        key={r.id}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          padding: isChild ? "6px 0 6px 24px" : "10px 0",
                          borderBottom: "1px solid #f9fafb",
                          fontSize: 13,
                          color: "#111827",
                          fontWeight: isParent ? 600 : 400,
                        }}
                      >
                        <span>{isChild && <span style={{ color: "#9ca3af", marginRight: 6 }}>↳</span>}{r.labelEn}</span>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Edit reasons Action Button */}
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
                <button
                  type="button"
                  className="returbo-btn-primary"
                  onClick={handleStartEdit}
                  style={{ padding: "8px 20px" }}
                >
                  Edit reasons
                </button>
              </div>
            </div>
          ) : (
            /* =========================================================================
                EDIT MODE
               ========================================================================= */
            <div>
              <form onSubmit={handleSave}>
                <input type="hidden" name="_action" value="save_return_reasons" />

                {/* Top Controls in Edit Mode: Archived reasons button */}
                <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
                  <button
                    type="button"
                    onClick={() => setShowArchived((v) => !v)}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      background: showArchived ? "#f3f4f6" : "#ffffff",
                      border: "1px solid #d1d5db",
                      borderRadius: 8,
                      padding: "6px 14px",
                      fontSize: 13,
                      color: "#374151",
                      fontWeight: 500,
                      cursor: "pointer",
                    }}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="21 8 21 21 3 21 3 8" />
                      <rect x="1" y="3" width="22" height="5" />
                      <line x1="10" y1="12" x2="14" y2="12" />
                    </svg>
                    <span>{showArchived ? "Hide archived" : `Archived reasons (${archivedReasons.length})`}</span>
                  </button>
                </div>

                {/* Show Archived Reasons Section if toggled */}
                {showArchived && (
                  <div style={{ background: "#f9fafb", padding: 14, borderRadius: 8, marginBottom: 18, border: "1px solid #e5e7eb" }}>
                    <h4 style={{ margin: "0 0 10px 0", fontSize: 13, fontWeight: 700, color: "#374151" }}>
                      Archived / Inactive Reasons ({archivedReasons.length})
                    </h4>
                    {archivedReasons.length === 0 ? (
                      <p style={{ fontSize: 12, color: "#6b7280", margin: 0 }}>No archived reasons.</p>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {archivedReasons.map((ar) => (
                          <div key={ar.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, padding: "4px 0" }}>
                            <span>{ar.labelEn}</span>
                            <button
                              type="button"
                              onClick={() => handleUnarchiveReason(ar.id)}
                              className="returbo-btn-secondary"
                              style={{ padding: "4px 10px", fontSize: 11 }}
                            >
                              Restore
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Returns Section Header with Restock column title */}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    paddingBottom: 8,
                    marginBottom: 10,
                    borderBottom: "1px solid #e5e7eb",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <h3 style={{ fontSize: 16, fontWeight: 700, color: "#111827", margin: 0 }}>Returns</h3>
                    <button
                      type="button"
                      onClick={() => setHideReturns((v) => !v)}
                      style={{
                        background: "#ffffff",
                        border: "1px solid #e5e7eb",
                        borderRadius: 6,
                        padding: "2px 8px",
                        fontSize: 12,
                        color: "#4b5563",
                        cursor: "pointer",
                      }}
                    >
                      {hideReturns ? "Show reasons" : "Hide reasons"}
                    </button>
                  </div>
                </div>

                {/* Returns Reasons Items with Checkboxes, 3-dots, and Toggles */}
                {!hideReturns && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 2, marginBottom: 20 }}>
                    {returnReasons
                      .filter((r) => (showArchived ? true : r.active))
                      .map((r) => {
                        const isChild = Boolean(getParentLabel(r));
                        const isParent = returnReasons.some((child) => getParentLabel(child) === r.labelEn);
                        const currentActive = editState[r.id]?.active ?? r.active;

                        return (
                          <div
                            key={r.id}
                            style={{
                              position: "relative",
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              padding: isChild ? "8px 0 8px 30px" : "10px 0",
                              borderBottom: "1px solid #f3f4f6",
                            }}
                          >
                            {/* Hidden inputs submitted with the form */}
                            <input
                              type="hidden"
                              name={`reason_active_${r.id}`}
                              value={currentActive ? "on" : "off"}
                            />
                            {/* Left: Checkbox, Label, and 3-dots button */}
                            <div style={{ display: "flex", alignItems: "center", gap: 10, position: "relative" }}>
                              {isChild && (
                                <span style={{ color: "#9ca3af", fontSize: 13, marginRight: -2 }}>↳</span>
                              )}
                              <div
                                onClick={() => toggleActive(r.id, r.labelEn)}
                                style={{
                                  width: 18,
                                  height: 18,
                                  borderRadius: 4,
                                  border: currentActive ? "none" : "1.5px solid #d1d5db",
                                  background: currentActive ? "var(--returbo-pink)" : "#ffffff",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  cursor: "pointer",
                                  flexShrink: 0,
                                  transition: "all 0.15s",
                                }}
                              >
                                {currentActive && (
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="20 6 9 17 4 12" />
                                  </svg>
                                )}
                              </div>
                              <span
                                style={{
                                  fontSize: 13,
                                  fontWeight: isParent ? 600 : 500,
                                  color: currentActive ? "#111827" : "#4b5563",
                                  cursor: "pointer",
                                }}
                                onClick={() => toggleActive(r.id, r.labelEn)}
                              >
                                {r.labelEn}
                              </span>

                              {/* 3-dots Button */}
                              <div style={{ position: "relative" }}>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setOpenMenuId(openMenuId === r.id ? null : r.id);
                                  }}
                                  style={{
                                    background: openMenuId === r.id ? "#f3f4f6" : "none",
                                    border: "none",
                                    padding: "2px 6px",
                                    color: "#9ca3af",
                                    fontSize: 16,
                                    cursor: "pointer",
                                    borderRadius: 4,
                                    display: "inline-flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    lineHeight: 1,
                                    transition: "background 0.15s",
                                  }}
                                  title="Reason options"
                                >
                                  ⋮
                                </button>

                                {/* 3-dots Popup Dropdown Menu */}
                                {openMenuId === r.id && (
                                  <div
                                    style={{
                                      position: "absolute",
                                      top: "100%",
                                      left: 0,
                                      background: "#ffffff",
                                      border: "1px solid #e5e7eb",
                                      borderRadius: 8,
                                      boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.12), 0 8px 10px -6px rgba(0, 0, 0, 0.08)",
                                      padding: "6px 0",
                                      minWidth: 195,
                                      zIndex: 100,
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    {/* 1. Add sub-reason */}
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setOpenMenuId(null);
                                        setSubReasonParent({ id: r.id, label: r.labelEn, appliesTo: r.appliesTo });
                                        setSubReasonLabel("");
                                      }}
                                      className="returbo-reason-menu-item"
                                    >
                                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <polyline points="9 10 4 15 9 20" />
                                        <path d="M20 4v7a4 4 0 0 1-4 4H4" />
                                      </svg>
                                      <span>Add sub-reason</span>
                                    </button>

                                    {/* 2. Update reason code */}
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setOpenMenuId(null);
                                        setCodeEditReason({
                                          id: r.id,
                                          label: r.labelEn,
                                          currentCode: "",
                                        });
                                        setCodeValue("");
                                      }}
                                      className="returbo-reason-menu-item"
                                    >
                                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M3 5v14M8 5v14M12 5v14M17 5v14M21 5v14" />
                                      </svg>
                                      <span>Update reason code</span>
                                    </button>

                                    {/* 3. Archive reason */}
                                    <button
                                      type="button"
                                      onClick={() => handleArchiveReason(r.id)}
                                      className="returbo-reason-menu-item"
                                    >
                                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <polyline points="21 8 21 21 3 21 3 8" />
                                        <rect x="1" y="3" width="22" height="5" />
                                        <line x1="10" y1="12" x2="14" y2="12" />
                                      </svg>
                                      <span>Archive reason</span>
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>

                          </div>
                        );
                      })}
                  </div>
                )}

                {/* Add custom return reason */}
                <div style={{ marginBottom: 28 }}>
                  {!showAddReturn ? (
                    <button
                      type="button"
                      onClick={() => setShowAddReturn(true)}
                      style={{
                        background: "none",
                        border: "none",
                        padding: 0,
                        color: "var(--returbo-pink)",
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      + Add a custom return reason
                    </button>
                  ) : (
                    <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8 }}>
                      <input
                        type="text"
                        placeholder="e.g. Size too loose"
                        value={newReturnLabel}
                        onChange={(e) => setNewReturnLabel(e.target.value)}
                        className="returbo-detail-input"
                        style={{ maxWidth: 280 }}
                      />
                      <button
                        type="button"
                        onClick={handleAddCustomReturn}
                        className="returbo-btn-primary"
                        style={{ padding: "6px 14px", fontSize: 12 }}
                      >
                        Add reason
                      </button>
                      <button
                        type="button"
                        className="returbo-btn-secondary"
                        onClick={() => setShowAddReturn(false)}
                        style={{ padding: "6px 12px", fontSize: 12 }}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>

                {/* Complaints Section Header */}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    paddingBottom: 8,
                    marginBottom: 10,
                    borderBottom: "1px solid #e5e7eb",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <h3 style={{ fontSize: 16, fontWeight: 700, color: "#111827", margin: 0 }}>Complaints</h3>
                    <button
                      type="button"
                      onClick={() => setHideComplaints((v) => !v)}
                      style={{
                        background: "#ffffff",
                        border: "1px solid #e5e7eb",
                        borderRadius: 6,
                        padding: "2px 8px",
                        fontSize: 12,
                        color: "#4b5563",
                        cursor: "pointer",
                      }}
                    >
                      {hideComplaints ? "Show complaints" : "Hide complaints"}
                    </button>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>Restock</div>
                </div>

                {/* Complaints Items */}
                {!hideComplaints && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 2, marginBottom: 20 }}>
                    {complaintReasons.filter((r) => showArchived || r.active).map((r) => {
                      const currentActive = editState[r.id]?.active ?? r.active;
                      return (
                        <div
                          key={r.id}
                          style={{
                            position: "relative",
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            padding: "10px 0",
                            borderBottom: "1px solid #f3f4f6",
                          }}
                        >
                          <input
                            type="hidden"
                            name={`reason_active_${r.id}`}
                            value={currentActive ? "on" : "off"}
                          />
                          <div style={{ display: "flex", alignItems: "center", gap: 10, position: "relative" }}>
                            <div
                              onClick={() => toggleActive(r.id, r.labelEn)}
                              style={{
                                width: 18,
                                height: 18,
                                borderRadius: 4,
                                border: currentActive ? "none" : "1.5px solid #d1d5db",
                                background: currentActive ? "var(--returbo-pink)" : "#ffffff",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                cursor: "pointer",
                                flexShrink: 0,
                                transition: "all 0.15s",
                              }}
                            >
                              {currentActive && (
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                  <polyline points="20 6 9 17 4 12" />
                                </svg>
                              )}
                            </div>
                            <span
                              style={{
                                fontSize: 13,
                                fontWeight: 500,
                                color: currentActive ? "#111827" : "#4b5563",
                                cursor: "pointer",
                              }}
                              onClick={() => toggleActive(r.id, r.labelEn)}
                            >
                              {r.labelEn}
                            </span>

                            {/* 3-dots Button for Complaints */}
                            <div style={{ position: "relative" }}>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setOpenMenuId(openMenuId === r.id ? null : r.id);
                                }}
                                style={{
                                  background: openMenuId === r.id ? "#f3f4f6" : "none",
                                  border: "none",
                                  padding: "2px 6px",
                                  color: "#9ca3af",
                                  fontSize: 16,
                                  cursor: "pointer",
                                  borderRadius: 4,
                                  display: "inline-flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  lineHeight: 1,
                                }}
                                title="Complaint options"
                              >
                                ⋮
                              </button>

                              {openMenuId === r.id && (
                                <div
                                  style={{
                                    position: "absolute",
                                    top: "100%",
                                    left: 0,
                                    background: "#ffffff",
                                    border: "1px solid #e5e7eb",
                                    borderRadius: 8,
                                    boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.12), 0 8px 10px -6px rgba(0, 0, 0, 0.08)",
                                    padding: "6px 0",
                                    minWidth: 195,
                                    zIndex: 100,
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {/* Update code */}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setOpenMenuId(null);
                                      setCodeEditReason({
                                        id: r.id,
                                        label: r.labelEn,
                                        currentCode: "",
                                      });
                                      setCodeValue("");
                                    }}
                                    className="returbo-reason-menu-item"
                                  >
                                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                      <path d="M3 5v14M8 5v14M12 5v14M17 5v14M21 5v14" />
                                    </svg>
                                    <span>Update reason code</span>
                                  </button>

                                  {/* Archive */}
                                  <button
                                    type="button"
                                    onClick={() => handleArchiveReason(r.id)}
                                    className="returbo-reason-menu-item"
                                  >
                                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                      <polyline points="21 8 21 21 3 21 3 8" />
                                      <rect x="1" y="3" width="22" height="5" />
                                      <line x1="10" y1="12" x2="14" y2="12" />
                                    </svg>
                                    <span>Archive reason</span>
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Complaints are never restocked */}
                          <div style={{ fontSize: 12, color: "#9ca3af", fontStyle: "italic" }}>
                            No restock
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Add custom complaint */}
                <div style={{ marginBottom: 28 }}>
                  {!showAddComplaint ? (
                    <button
                      type="button"
                      onClick={() => setShowAddComplaint(true)}
                      style={{
                        background: "none",
                        border: "none",
                        padding: 0,
                        color: "var(--returbo-pink)",
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      + Add a custom complaint
                    </button>
                  ) : (
                    <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8 }}>
                      <input
                        type="text"
                        placeholder="e.g. Broken zipper"
                        value={newComplaintLabel}
                        onChange={(e) => setNewComplaintLabel(e.target.value)}
                        className="returbo-detail-input"
                        style={{ maxWidth: 280 }}
                      />
                      <button
                        type="button"
                        onClick={handleAddCustomComplaint}
                        className="returbo-btn-primary"
                        style={{ padding: "6px 14px", fontSize: 12 }}
                      >
                        Add complaint
                      </button>
                      <button
                        type="button"
                        className="returbo-btn-secondary"
                        onClick={() => setShowAddComplaint(false)}
                        style={{ padding: "6px 12px", fontSize: 12 }}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>

                {/* Edit Mode Bottom Actions */}
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, borderTop: "1px solid #f3f4f6", paddingTop: 16 }}>
                  <button
                    type="button"
                    className="returbo-btn-secondary"
                    onClick={handleCancelEdit}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="returbo-btn-primary"
                  >
                    Save changes
                  </button>
                </div>
              </form>

              {/* Modal Dialog: Add Sub-Reason */}
              {subReasonParent && (
                <div
                  style={{
                    position: "fixed",
                    inset: 0,
                    background: "rgba(0,0,0,0.4)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    zIndex: 1000,
                  }}
                  onClick={() => setSubReasonParent(null)}
                >
                  <div
                    style={{
                      background: "#ffffff",
                      borderRadius: 12,
                      padding: 24,
                      maxWidth: 420,
                      width: "90%",
                      boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <h3 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 8px 0", color: "#111827" }}>
                      Add Sub-reason
                    </h3>
                    <p style={{ fontSize: 13, color: "#6b7280", margin: "0 0 16px 0" }}>
                      Add a specific child reason under <strong>{subReasonParent.label}</strong>.
                    </p>
                    <form onSubmit={handleSaveSubReason}>
                      <div style={{ marginBottom: 16 }}>
                        <label style={{ display: "block", fontSize: 12, fontWeight: 500, color: "#374151", marginBottom: 6 }}>
                          Sub-reason name:
                        </label>
                        <input
                          type="text"
                          required
                          value={subReasonLabel}
                          onChange={(e) => setSubReasonLabel(e.target.value)}
                          placeholder="e.g. Sleeves too long / Color faded"
                          className="returbo-detail-input"
                          style={{ width: "100%" }}
                        />
                      </div>
                      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                        <button
                          type="button"
                          className="returbo-btn-secondary"
                          onClick={() => setSubReasonParent(null)}
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          className="returbo-btn-primary"
                        >
                          Save sub-reason
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              )}

              {/* Modal Dialog: Update Reason Code */}
              {codeEditReason && (
                <div
                  style={{
                    position: "fixed",
                    inset: 0,
                    background: "rgba(0,0,0,0.4)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    zIndex: 1000,
                  }}
                  onClick={() => setCodeEditReason(null)}
                >
                  <div
                    style={{
                      background: "#ffffff",
                      borderRadius: 12,
                      padding: 24,
                      maxWidth: 420,
                      width: "90%",
                      boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <h3 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 8px 0", color: "#111827" }}>
                      Update Reason Code
                    </h3>
                    <p style={{ fontSize: 13, color: "#6b7280", margin: "0 0 16px 0" }}>
                      Assign an internal ERP or warehouse return code for <strong>{codeEditReason.label}</strong>.
                    </p>
                    <form onSubmit={handleSaveReasonCode}>
                      <div style={{ marginBottom: 16 }}>
                        <label style={{ display: "block", fontSize: 12, fontWeight: 500, color: "#374151", marginBottom: 6 }}>
                          Reason Code:
                        </label>
                        <input
                          type="text"
                          required
                          value={codeValue}
                          onChange={(e) => setCodeValue(e.target.value)}
                          placeholder="e.g. WRONG_SIZE, DEFECTIVE, RET-01"
                          className="returbo-detail-input"
                          style={{ width: "100%" }}
                        />
                      </div>
                      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                        <button
                          type="button"
                          className="returbo-btn-secondary"
                          onClick={() => setCodeEditReason(null)}
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          className="returbo-btn-primary"
                        >
                          Save code
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
