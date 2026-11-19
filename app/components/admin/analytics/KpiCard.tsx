type Props = {
  label: string;
  value: string;
  trend: string;
  good: boolean;
  highlight?: boolean;
};

export default function KpiCard({ label, value, trend, good, highlight }: Props) {
  const bg = highlight ? "linear-gradient(180deg, #ffffff 0%, #fdf2f4 100%)" : "#ffffff";
  const fg = "#111827";
  const labelColor = highlight ? "var(--returbo-pink, #de4066)" : "#6b7280";
  const borderColor = highlight ? "var(--returbo-pink-border, #fbcfe8)" : "var(--returbo-border, #e5e7eb)";

  return (
    <div
      style={{
        background: bg,
        color: fg,
        borderRadius: 12,
        border: `1px solid ${borderColor}`,
        boxShadow: "var(--returbo-shadow, 0 1px 3px 0 rgba(0, 0, 0, 0.04))",
        padding: 20,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 600, color: labelColor, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, lineHeight: 1, color: highlight ? "var(--returbo-pink, #de4066)" : "#111827" }}>{value}</div>
      <div style={{ fontSize: 12, color: good ? "#16a34a" : "#dc2626", fontWeight: 500 }}>{trend}</div>
    </div>
  );
}
