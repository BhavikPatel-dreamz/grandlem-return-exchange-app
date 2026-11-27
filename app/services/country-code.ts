// ISO 3166-1 alpha-2 codes for addresses sent to ShippyPro, which only
// accepts 2-letter countries. Pure module: safe for server and client code.

const ALIASES: Record<string, string> = {
  uk: "GB",
  "great britain": "GB",
  england: "GB",
  usa: "US",
  "united states of america": "US",
  america: "US",
  sverige: "SE",
};

let byName: Map<string, string> | null = null;

function nameIndex(): Map<string, string> {
  if (byName) return byName;
  byName = new Map();
  const names = new Intl.DisplayNames(["en"], { type: "region" });
  const A = "A".charCodeAt(0);
  for (let i = 0; i < 26; i++) {
    for (let j = 0; j < 26; j++) {
      const code = String.fromCharCode(A + i, A + j);
      try {
        const name = names.of(code);
        if (name && name !== code) byName.set(name.toLowerCase(), code);
      } catch {
        // not a region code
      }
    }
  }
  return byName;
}

/** "Sweden" / "se" / "SE" -> "SE". Returns the trimmed input when unknown. */
export function toCountryCode(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  if (/^[a-z]{2}$/i.test(raw)) return raw.toUpperCase();
  const key = raw.toLowerCase();
  return ALIASES[key] ?? nameIndex().get(key) ?? raw;
}

export function isCountryCode(value: string | null | undefined): boolean {
  return /^[A-Z]{2}$/.test(String(value ?? ""));
}
