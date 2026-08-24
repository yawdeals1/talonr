import { useState } from "react";
import type { Lead } from "../api/types";
import { formatDateTime, formatNumber } from "../lib/format";
import { useDialogA11y } from "../lib/useDialogA11y";

export function LeadDetailDrawer({
  lead,
  onClose,
  onDelete,
}: {
  lead: Lead;
  onClose: () => void;
  onDelete?: (lead: Lead) => void;
}) {
  const { titleId, panelRef } = useDialogA11y(onClose);
  const [showJson, setShowJson] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-xs" onClick={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="h-full w-full max-w-md overflow-y-auto border-l bg-white p-6 outline-none shadow-2xl dark:bg-zinc-950 dark:border-zinc-800"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-6 flex items-start justify-between border-b pb-4 dark:border-zinc-800">
          <div className="flex items-center gap-3">
            {lead.profileImage ? (
              <img src={lead.profileImage} alt="" className="h-12 w-12 rounded-full border object-cover dark:border-zinc-700" />
            ) : (
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-200 font-mono text-base font-bold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                {lead.handle.substring(0, 1).toUpperCase()}
              </div>
            )}
            <div>
              <div className="flex items-center gap-2">
                <a
                  id={titleId}
                  href={`https://x.com/${lead.handle}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-base font-bold text-amber-700 hover:underline dark:text-amber-400"
                >
                  @{lead.handle}
                </a>
                {lead.verified && (
                  <span className="rounded border border-blue-500/20 bg-blue-500/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-blue-600 dark:text-blue-400">
                    VERIFIED
                  </span>
                )}
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">{lead.displayName ?? "—"}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="-mr-1 flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
            aria-label="Close"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-5 text-xs">
          <a
            href={`https://x.com/${lead.handle}`}
            target="_blank"
            rel="noreferrer"
            className="flex w-full items-center justify-center gap-2 rounded-md bg-zinc-900 px-4 py-2 font-semibold text-white transition-opacity hover:opacity-90 dark:bg-zinc-100 dark:text-zinc-900"
          >
            <span>Open X Profile</span>
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
            </svg>
          </a>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-md border p-3 dark:border-zinc-800 dark:bg-zinc-900/40">
              <span className="font-mono text-[10px] uppercase text-zinc-400">Followers</span>
              <p className="mt-1 font-mono text-base font-bold text-zinc-900 dark:text-zinc-100">
                {lead.followers !== null ? formatNumber(lead.followers) : "—"}
              </p>
            </div>
            <div className="rounded-md border p-3 dark:border-zinc-800 dark:bg-zinc-900/40">
              <span className="font-mono text-[10px] uppercase text-zinc-400">Source Type</span>
              <p className="mt-1 font-mono text-base font-bold capitalize text-zinc-900 dark:text-zinc-100">
                {lead.sourceType}
              </p>
            </div>
          </div>

          <div className="rounded-md border p-3 dark:border-zinc-800 dark:bg-zinc-900/40">
            <span className="font-mono text-[10px] uppercase text-zinc-400">Bio</span>
            <p className="mt-1 text-zinc-700 leading-relaxed dark:text-zinc-300">{lead.bio ?? "No bio available."}</p>
          </div>

          <div className="space-y-2 rounded-md border p-3 dark:border-zinc-800 dark:bg-zinc-900/40">
            <div className="flex justify-between">
              <span className="text-zinc-500 dark:text-zinc-400">Location</span>
              <span className="font-medium text-zinc-900 dark:text-zinc-200">{lead.location ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500 dark:text-zinc-400">Source Reference</span>
              <span className="font-mono text-zinc-900 truncate max-w-[200px] dark:text-zinc-200">{lead.sourceRef}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500 dark:text-zinc-400">First Seen</span>
              <span className="font-mono text-zinc-900 dark:text-zinc-200">{formatDateTime(lead.firstSeenAt)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500 dark:text-zinc-400">Last Seen</span>
              <span className="font-mono text-zinc-900 dark:text-zinc-200">{formatDateTime(lead.lastSeenAt)}</span>
            </div>
          </div>

          <div>
            <button
              type="button"
              onClick={() => setShowJson(!showJson)}
              className="flex items-center gap-1 font-mono text-[11px] text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300"
            >
              <span>{showJson ? "Hide Raw Data" : "View Raw JSON Data"}</span>
              <svg className={`h-3 w-3 transform transition-transform ${showJson ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {showJson && (
              <pre className="mt-2 max-h-48 overflow-auto rounded border bg-zinc-900 p-3 font-mono text-[11px] text-emerald-400">
                {JSON.stringify(lead, null, 2)}
              </pre>
            )}
          </div>

          {onDelete && (
            <button
              type="button"
              onClick={() => onDelete(lead)}
              className="mt-4 w-full rounded-md border border-red-500/20 px-4 py-2 font-mono text-xs font-medium text-red-600 hover:bg-red-500/10 dark:text-red-400"
            >
              Delete Lead
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
