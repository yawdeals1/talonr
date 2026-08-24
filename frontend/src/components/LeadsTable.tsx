import type { Lead } from "../api/types";
import { formatNumber, formatRelative } from "../lib/format";

function VerifiedBadge() {
  return (
    <span className="inline-flex items-center gap-0.5 rounded border border-blue-500/20 bg-blue-500/10 px-1.5 py-0.2 font-mono text-[10px] font-semibold text-blue-600 dark:text-blue-400">
      <svg className="h-3 w-3 fill-current" viewBox="0 0 24 24">
        <path d="M22.5 12.5c0-1.58-.875-2.95-2.148-3.6.154-.435.238-.905.238-1.4 0-2.21-1.79-4-4-4-.495 0-.965.084-1.4.238C14.55 2.475 13.18 1.6 11.6 1.6c-1.58 0-2.95.875-3.6 2.148-.435-.154-.905-.238-1.4-.238-2.21 0-4 1.79-4 4 0 .495.084.965.238 1.4C1.575 9.55.7 10.92.7 12.5c0 1.58.875 2.95 2.148 3.6-.154.435-.238.905-.238 1.4 0 2.21 1.79 4 4 4 .495 0 .965-.084 1.4-.238 1.15 1.273 2.52 2.148 4.1 2.148 1.58 0 2.95-.875 3.6-2.148.435.154.905.238 1.4.238 2.21 0 4-1.79 4-4 0-.495-.084-.965-.238-1.4 1.273-1.15 2.148-2.52 2.148-4.1zm-12.8 4.2l-3.5-3.5 1.4-1.4 2.1 2.1 5.3-5.3 1.4 1.4-6.7 6.7z" />
      </svg>
    </span>
  );
}
export function LeadsTable({
  leads,
  onRowClick,
  onDelete,
  selectedLeadIds,
  onSelectionChange,
  onSelectAll,
}: {
  leads: Lead[];
  onRowClick: (lead: Lead) => void;
  onDelete?: (lead: Lead) => void;
  selectedLeadIds?: Set<string>;
  onSelectionChange?: (leadId: string, selected: boolean) => void;
  onSelectAll?: (selected: boolean) => void;
}) {
  const selectionEnabled = selectedLeadIds !== undefined && onSelectionChange !== undefined;
  const allSelected = selectionEnabled && leads.length > 0 && leads.every((lead) => selectedLeadIds.has(lead.id));

  return (
    <div className="overflow-x-auto rounded-lg border bg-white dark:bg-zinc-950 dark:border-zinc-800">
      <table className="w-full text-left text-xs">
        <thead className="border-b bg-zinc-50 font-mono text-[11px] uppercase tracking-wider text-zinc-500 dark:bg-zinc-900/60 dark:border-zinc-800 dark:text-zinc-400">
          <tr>
            {selectionEnabled && (
              <th className="w-10 px-3 py-2.5 font-medium">
                <input
                  type="checkbox"
                  aria-label="Select all leads on this page"
                  checked={allSelected}
                  onChange={(event) => onSelectAll?.(event.target.checked)}
                  className="h-3.5 w-3.5 rounded border-zinc-300 accent-amber-600 dark:border-zinc-700"
                />
              </th>
            )}
            <th className="px-3.5 py-2.5 font-medium">Handle</th>
            <th className="px-3.5 py-2.5 font-medium">Name</th>
            <th className="px-3.5 py-2.5 font-medium">Bio</th>
            <th className="px-3.5 py-2.5 font-medium">Followers</th>
            <th className="px-3.5 py-2.5 font-medium">Location</th>
            <th className="px-3.5 py-2.5 font-medium">Source</th>
            <th className="px-3.5 py-2.5 font-medium">Last seen</th>
            {onDelete && <th className="px-3.5 py-2.5 text-right font-medium">Actions</th>}
          </tr>
        </thead>
        <tbody className="divide-y dark:divide-zinc-800/60">
          {leads.map((lead) => {
            const isSelected = selectedLeadIds?.has(lead.id);
            return (
              <tr
                key={lead.id}
                className={`group cursor-pointer transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900/50 ${
                  isSelected ? "bg-amber-500/5 dark:bg-amber-500/10" : ""
                }`}
                onClick={() => onRowClick(lead)}
              >
                {selectionEnabled && (
                  <td className="w-10 px-3 py-2.5" onClick={(event) => event.stopPropagation()}>
                    <input
                      type="checkbox"
                      aria-label={`Select @${lead.handle}`}
                      checked={isSelected}
                      onChange={(event) => onSelectionChange(lead.id, event.target.checked)}
                      className="h-3.5 w-3.5 rounded border-zinc-300 accent-amber-600 dark:border-zinc-700"
                    />
                  </td>
                )}
                <td className="px-3.5 py-2.5">
                  <div className="flex items-center gap-2">
                    {lead.profileImage ? (
                      <img src={lead.profileImage} alt="" className="h-6 w-6 shrink-0 rounded-full object-cover border dark:border-zinc-700" />
                    ) : (
                      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-200 font-mono text-[10px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                        {lead.handle.substring(0, 1).toUpperCase()}
                      </div>
                    )}
                    <a
                      href={`https://x.com/${lead.handle}`}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="font-mono text-xs font-semibold text-amber-700 hover:underline dark:text-amber-400"
                    >
                      @{lead.handle}
                    </a>
                    {lead.verified && <VerifiedBadge />}
                  </div>
                </td>
                <td className="max-w-[140px] truncate px-3.5 py-2.5 font-medium text-zinc-900 dark:text-zinc-100">
                  {lead.displayName ?? "—"}
                </td>
                <td className="max-w-[220px] truncate px-3.5 py-2.5 text-zinc-500 dark:text-zinc-400" title={lead.bio ?? undefined}>
                  {lead.bio ?? "—"}
                </td>
                <td className="px-3.5 py-2.5 font-mono font-medium text-zinc-900 dark:text-zinc-100">
                  {lead.followers !== null ? formatNumber(lead.followers) : "—"}
                </td>
                <td className="max-w-[120px] truncate px-3.5 py-2.5 text-zinc-500 dark:text-zinc-400">
                  {lead.location ?? "—"}
                </td>
                <td className="px-3.5 py-2.5 text-xs text-zinc-500 dark:text-zinc-400">
                  <span className="inline-flex rounded border bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px] uppercase dark:bg-zinc-800 dark:border-zinc-700">
                    {lead.sourceType}
                  </span>
                </td>
                <td className="px-3.5 py-2.5 font-mono text-zinc-500 dark:text-zinc-400">
                  {formatRelative(lead.lastSeenAt)}
                </td>
                {onDelete && (
                  <td className="px-3.5 py-2.5 text-right" onClick={(event) => event.stopPropagation()}>
                    <button
                      type="button"
                      onClick={() => onDelete(lead)}
                      className="rounded border border-red-500/20 px-2 py-0.5 font-mono text-[11px] text-red-600 hover:bg-red-500/10 dark:text-red-400"
                    >
                      Delete
                    </button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
