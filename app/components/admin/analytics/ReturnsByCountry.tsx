import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer } from "recharts";

type Item = { country: string; count: number };

type Props = { items: Item[] };

export default function ReturnsByCountry({ items }: Props) {
  const data = items.map((it) => ({ country: it.country, count: it.count }));
  return (
    <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb", padding: 20 }}>
      <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Returns by country</div>
      {items.length === 0 ? (
        <div style={{ padding: 20, textAlign: "center", color: "#9ca3af" }}>No data</div>
      ) : (
        <div style={{ height: 240 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ left: 10, right: 20 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" />
              <YAxis type="category" dataKey="country" width={60} />
              <Bar dataKey="count" fill="#2563eb" radius={[0, 4, 4, 0]} label={{ position: "right", fontSize: 12 }} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
