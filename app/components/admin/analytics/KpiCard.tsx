type Props = {
  label: string;
  value: string;
  trend: string;
  good: boolean;
  highlight?: boolean;
};

export default function KpiCard({ label, value, trend, good, highlight }: Props) {
  const bg = highlight ? "#111827" : "#ffffff";
  const fg = highlight ? "#f9fafb" : "#111827";
  const labelColor = highlight ? "#9ca3af" : "#6b7280";

  return (
    <div
      style={{
        background: bg,
        color: fg,
        borderRadius: 12,
        border: highlight ? "none" : "1px solid #e5e7eb",
        padding: 20,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 600, color: labelColor, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 12, color: good ? "#16a34a" : "#dc2626", fontWeight: 500 }}>{trend}</div>
    </div>
  );
}
