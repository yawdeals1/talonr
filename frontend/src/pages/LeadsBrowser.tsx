import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { listLeads } from "../api/leads";
import type { Lead, SourceType } from "../api/types";
import { EmptyState } from "../components/EmptyState";
import { LeadDetailDrawer } from "../components/LeadDetailDrawer";
import { LeadsTable } from "../components/LeadsTable";
import { SkeletonRows } from "../components/Skeleton";

const PAGE_SIZE = 50;
// "likers" stays filterable for leads scraped before X locked down likes visibility in June 2024.
const SOURCE_TYPES: SourceType[] = ["search", "followers", "likers", "engagers"];

export function LeadsBrowser() {
  const [handle, setHandle] = useState("");
  const [sourceType, setSourceType] = useState<SourceType | "">("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Lead | null>(null);

  const query = useQuery({
    queryKey: ["leads", { handle, sourceType, page }],
    queryFn: () => listLeads({ handle: handle || undefined, sourceType: sourceType || undefined, page, pageSize: PAGE_SIZE }),
  });

  const leads = query.data?.leads ?? [];
  const hasFilters = handle || sourceType;
  const noLeadsAtAll = !query.isLoading && leads.length === 0 && page === 1 && !hasFilters;

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Leads</h1>

      <div className="flex flex-wrap gap-3">
        <input
          value={handle}
          onChange={(e) => {
            setHandle(e.target.value);
            setPage(1);
          }}
          placeholder="Search by handle…"
          className="w-64 rounded-md border bg-transparent px-3 py-1.5 text-sm outline-none focus:border-accent"
        />
        <select
          value={sourceType}
          onChange={(e) => {
            setSourceType(e.target.value as SourceType | "");
            setPage(1);
          }}
          className="rounded-md border bg-transparent px-3 py-1.5 text-sm text-zinc-900 outline-none focus:border-accent dark:text-zinc-100"
        >
          <option value="" className="bg-white text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100">
            All sources
          </option>
          {SOURCE_TYPES.map((s) => (
            <option key={s} value={s} className="bg-white text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100">
              {s}
            </option>
          ))}
        </select>
      </div>

      {query.isLoading ? (
        <SkeletonRows rows={8} cols={7} />
      ) : noLeadsAtAll ? (
        <EmptyState
          title="No leads yet"
          description="Trigger a scrape to start collecting leads."
          action={
            <Link
              to="/scrapes/new"
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              Trigger Scrape
            </Link>
          }
        />
      ) : leads.length === 0 ? (
        <EmptyState title="No leads match these filters" />
      ) : (
        <>
          <LeadsTable leads={leads} onRowClick={setSelected} />
          <div className="flex items-center justify-between text-sm text-zinc-500">
            <span>Page {page}</span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page === 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded-md border px-3 py-1 text-xs font-medium hover:bg-zinc-50 disabled:opacity-40 dark:hover:bg-zinc-800"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={leads.length < PAGE_SIZE}
                onClick={() => setPage((p) => p + 1)}
                className="rounded-md border px-3 py-1 text-xs font-medium hover:bg-zinc-50 disabled:opacity-40 dark:hover:bg-zinc-800"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}

      {selected && <LeadDetailDrawer lead={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
