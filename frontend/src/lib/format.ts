export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffSec = Math.round(diffMs / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}d ago`;
}

export function isToday(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  );
}

export function formatNumber(n: number): string {
  return n.toLocaleString();
}

function formatFollowerCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`;
  return String(n);
}

export function summarizeFilter(filter: {
  bioKeywords?: string[];
  minFollowers?: number;
  maxFollowers?: number;
  location?: string;
  verifiedOnly?: boolean;
}): string {
  const parts: string[] = [];
  if (filter.bioKeywords && filter.bioKeywords.length > 0) {
    parts.push(`bio: ${filter.bioKeywords.join(", ")}`);
  }
  if (filter.minFollowers !== undefined || filter.maxFollowers !== undefined) {
    const min = filter.minFollowers !== undefined ? formatFollowerCount(filter.minFollowers) : "0";
    const max = filter.maxFollowers !== undefined ? formatFollowerCount(filter.maxFollowers) : "∞";
    parts.push(`${min}–${max} followers`);
  }
  if (filter.location) {
    parts.push(`location: ${filter.location}`);
  }
  if (filter.verifiedOnly) {
    parts.push("verified only");
  }
  return parts.length > 0 ? parts.join(" · ") : "No filters — matches all leads";
}
