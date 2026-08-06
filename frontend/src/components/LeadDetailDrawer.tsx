import type { Lead } from "../api/types";
import { useDialogA11y } from "../lib/useDialogA11y";
import { formatDateTime, formatNumber } from "../lib/format";

export function LeadDetailDrawer({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const { titleId, panelRef } = useDialogA11y(onClose);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="h-full w-full max-w-sm overflow-y-auto border-l bg-white p-5 outline-none dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <div className="flex items-center gap-3">
            {lead.profileImage ? (
              <img src={lead.profileImage} alt="" className="h-10 w-10 rounded-full" />
            ) : (
              <div className="h-10 w-10 rounded-full bg-zinc-200 dark:bg-zinc-800" />
            )}
            <div>
              <a
                id={titleId}
                href={`https://x.com/${lead.handle}`}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-sm text-accent-text hover:underline"
              >
                @{lead.handle}
              </a>
              <p className="text-sm text-zinc-500">{lead.displayName ?? "—"}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="-m-2.5 flex h-11 w-11 items-center justify-center text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {lead.verified && (
          <span className="mb-4 inline-flex items-center rounded-full bg-status-info-bg px-2 py-0.5 text-xs font-medium text-status-info">
            ✓ verified
          </span>
        )}

        <dl className="space-y-3 text-sm">
          <div>
            <dt className="text-xs text-zinc-500">Bio</dt>
            <dd className="mt-0.5">{lead.bio ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">Followers</dt>
            <dd className="mt-0.5 font-mono">{lead.followers !== null ? formatNumber(lead.followers) : "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">Location</dt>
            <dd className="mt-0.5">{lead.location ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">Source</dt>
            <dd className="mt-0.5">
              <span className="capitalize">{lead.sourceType}</span> · {lead.sourceRef}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">First seen</dt>
            <dd className="mt-0.5 font-mono text-xs">{formatDateTime(lead.firstSeenAt)}</dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">Last seen</dt>
            <dd className="mt-0.5 font-mono text-xs">{formatDateTime(lead.lastSeenAt)}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
