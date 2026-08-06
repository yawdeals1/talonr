import type { Lead } from "../api/types";
import { formatNumber, formatRelative } from "../lib/format";

function VerifiedBadge() {
  return (
    <span className="inline-flex items-center rounded-full bg-status-info-bg px-1.5 py-0.5 text-[10px] font-medium text-status-info">
      ✓ verified
    </span>
  );
}

export function LeadsTable({ leads, onRowClick }: { leads: Lead[]; onRowClick: (lead: Lead) => void }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="border-b bg-zinc-50 text-left text-xs text-zinc-500 dark:bg-zinc-900/40">
          <tr>
            <th className="px-3 py-2 font-medium">Handle</th>
            <th className="px-3 py-2 font-medium">Name</th>
            <th className="px-3 py-2 font-medium">Bio</th>
            <th className="px-3 py-2 font-medium">Followers</th>
            <th className="px-3 py-2 font-medium">Location</th>
            <th className="px-3 py-2 font-medium">Source</th>
            <th className="px-3 py-2 font-medium">Last seen</th>
          </tr>
        </thead>
        <tbody>
          {leads.map((lead) => (
            <tr
              key={lead.id}
              className="cursor-pointer border-b last:border-0 hover:bg-zinc-50 dark:hover:bg-zinc-900/40"
              onClick={() => onRowClick(lead)}
            >
              <td className="px-3 py-2">
                <div className="flex items-center gap-2">
                  {lead.profileImage ? (
                    <img src={lead.profileImage} alt="" className="h-6 w-6 rounded-full" />
                  ) : (
                    <div className="h-6 w-6 rounded-full bg-zinc-200 dark:bg-zinc-800" />
                  )}
                  <a
                    href={`https://x.com/${lead.handle}`}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="font-mono text-xs text-accent-text hover:underline"
                  >
                    @{lead.handle}
                  </a>
                  {lead.verified && <VerifiedBadge />}
                </div>
              </td>
              <td className="max-w-[140px] truncate px-3 py-2">{lead.displayName ?? "—"}</td>
              <td className="max-w-[220px] truncate px-3 py-2 text-zinc-500" title={lead.bio ?? undefined}>
                {lead.bio ?? "—"}
              </td>
              <td className="px-3 py-2 font-mono">
                {lead.followers !== null ? formatNumber(lead.followers) : "—"}
              </td>
              <td className="max-w-[120px] truncate px-3 py-2 text-zinc-500">{lead.location ?? "—"}</td>
              <td className="px-3 py-2 text-xs text-zinc-500">
                <span className="capitalize">{lead.sourceType}</span>
              </td>
              <td className="px-3 py-2 text-xs text-zinc-500">{formatRelative(lead.lastSeenAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
