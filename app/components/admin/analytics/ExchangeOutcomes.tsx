import { CHART_PALETTE } from "./palette";

type Item = { label: string; percentage: number; count?: number };

type Props = { items: Item[] };

export default function ExchangeOutcomes({ items }: Props) {
  const colors = [CHART_PALETTE[5], CHART_PALETTE[0], CHART_PALETTE[2]];
  return (
    <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb", padding: 20 }}>
      <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Exchange outcome</div>
      {items.length === 0 ? (
        <div style={{ padding: 20, textAlign: "center", color: "#9ca3af" }}>No data</div>
      ) : (
        items.map((it, i) => (
          <div key={i} style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 8, height: 8, borderRadius: 4, background: colors[i % colors.length] }} />
                {it.label}
              </div>
              <div>{it.percentage}%</div>
            </div>
            <div style={{ width: "100%", height: 4, background: "#e5e7eb", borderRadius: 2, overflow: "hidden" }}>
              <div style={{ width: `${it.percentage}%`, height: "100%", background: colors[i % colors.length] }} />
            </div>
          </div>
        ))
      )}
    </div>
  );
}
