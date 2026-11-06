import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import { CHART_PALETTE } from "./palette";

type Item = { productName: string; quantity: number; percentage: number; colorIndex: number };

type Props = { items: Item[]; periodLabel: string };

export default function TopReturnedItems({ items, periodLabel }: Props) {
  const data = items.map((it) => ({ name: it.productName, value: it.quantity }));

  return (
    <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb", padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ fontSize: 16, fontWeight: 600 }}>Top 10 returned items</div>
        <div style={{ fontSize: 12, color: "#6b7280" }}>{periodLabel}</div>
      </div>
      {items.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: "#9ca3af" }}>No data</div>
      ) : (
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <div style={{ width: 240, height: 240 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={2}>
                  {data.map((_, i) => (
                    <Cell key={i} fill={CHART_PALETTE[items[i].colorIndex % CHART_PALETTE.length]} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div style={{ flex: 1, minWidth: 260 }}>
            {items.map((it, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <div style={{ width: 10, height: 10, borderRadius: 5, background: CHART_PALETTE[it.colorIndex % CHART_PALETTE.length] }} />
                <div style={{ flex: 1, fontSize: 13 }}>{it.productName}</div>
                <div style={{ width: 120, height: 6, background: "#e5e7eb", borderRadius: 3, overflow: "hidden" }}>
                  <div style={{ width: `${it.percentage}%`, height: "100%", background: CHART_PALETTE[it.colorIndex % CHART_PALETTE.length] }} />
                </div>
                <div style={{ fontSize: 12, color: "#6b7280", minWidth: 60, textAlign: "right" }}>
                  {it.percentage}% ({it.quantity})
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
