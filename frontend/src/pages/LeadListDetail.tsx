import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { evaluateLeadList } from "../api/leadLists";
import type { Lead } from "../api/types";
import { EmptyState } from "../components/EmptyState";
import { LeadDetailDrawer } from "../components/LeadDetailDrawer";
import { LeadsTable } from "../components/LeadsTable";
import { SkeletonRows } from "../components/Skeleton";
import { summarizeFilter } from "../lib/format";

const PAGE_SIZE = 50;

export function LeadListDetail() {
  const { id } = useParams<{ id: string }>();
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Lead | null>(null);

  const query = useQuery({
    queryKey: ["leadLists", id, "evaluate", page],
    queryFn: () => evaluateLeadList(id!, page, PAGE_SIZE),
  });

  if (query.isLoading) {
    return <SkeletonRows rows={8} cols={7} />;
  }

  if (!query.data) {
    return <div className="text-sm text-zinc-500">Lead list not found.</div>;
  }

  const { list, leads, total } = query.data;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <div>
        <Link to="/lead-lists" className="text-xs font-medium text-accent-text hover:underline">
          ← All lead lists
        </Link>
      </div>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{list.name}</h1>
          <p className="mt-1 text-sm text-zinc-500">{summarizeFilter(list.filterDefinition)}</p>
        </div>
        <Link
          to={`/lead-lists/${list.id}/edit`}
          className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800"
        >
          Edit filter
        </Link>
      </div>

      {leads.length === 0 ? (
        <EmptyState title="No leads match this filter" description="Try widening the criteria, or scrape more leads." />
      ) : (
        <>
          <LeadsTable leads={leads} onRowClick={setSelected} />
          <div className="flex items-center justify-between text-sm text-zinc-500">
            <span>
              Page {page} of {totalPages} · {total} matching lead{total === 1 ? "" : "s"}
            </span>
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
                disabled={page >= totalPages}
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
