import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { listActivity, listUsers } from "../../api/admin";
import { EmptyState } from "../../components/EmptyState";
import { SkeletonRows } from "../../components/Skeleton";
import { formatDateTime } from "../../lib/format";

const PAGE_SIZE = 50;

const ACTION_LABELS: Record<string, string> = {
  "user.registered": "User registered",
  "user.logged_in": "User logged in",
  "scrape.completed": "Scrape completed",
  "account.checkpointed": "Account checkpointed",
};

function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

function MetadataSummary({ metadata }: { metadata: Record<string, unknown> | null }) {
  if (!metadata) return <span className="text-zinc-400">—</span>;
  const entries = Object.entries(metadata);
  if (entries.length === 0) return <span className="text-zinc-400">—</span>;
  return (
    <span className="font-mono text-xs text-zinc-500">
      {entries.map(([k, v]) => `${k}: ${String(v)}`).join(" · ")}
    </span>
  );
}

export function AdminActivity() {
  const [userId, setUserId] = useState("");
  const [action, setAction] = useState("");
  const [page, setPage] = useState(1);

  const usersQuery = useQuery({ queryKey: ["admin", "users"], queryFn: listUsers });
  const users = usersQuery.data?.users ?? [];
  const userById = new Map(users.map((u) => [u.id, u]));

  const activityQuery = useQuery({
    queryKey: ["admin", "activity", { userId, action, page }],
    queryFn: () => listActivity({ userId: userId || undefined, action: action || undefined, page, pageSize: PAGE_SIZE }),
  });

  const entries = activityQuery.data?.activity ?? [];

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Activity Feed</h1>

      <div className="flex flex-wrap gap-3">
        <select
          value={userId}
          onChange={(e) => {
            setUserId(e.target.value);
            setPage(1);
          }}
          className="rounded-md border bg-transparent px-3 py-1.5 text-sm outline-none focus:border-accent"
        >
          <option value="">All users</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.email}
            </option>
          ))}
        </select>
        <select
          value={action}
          onChange={(e) => {
            setAction(e.target.value);
            setPage(1);
          }}
          className="rounded-md border bg-transparent px-3 py-1.5 text-sm outline-none focus:border-accent"
        >
          <option value="">All actions</option>
          {Object.entries(ACTION_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {activityQuery.isLoading ? (
        <SkeletonRows rows={8} cols={4} />
      ) : entries.length === 0 ? (
        <EmptyState title="No activity matches these filters" />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="border-b bg-zinc-50 text-left text-xs text-zinc-500 dark:bg-zinc-900/40">
                <tr>
                  <th className="px-3 py-2 font-medium">Time</th>
                  <th className="px-3 py-2 font-medium">User</th>
                  <th className="px-3 py-2 font-medium">Action</th>
                  <th className="px-3 py-2 font-medium">Details</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id} className="border-b last:border-0">
                    <td className="px-3 py-2 font-mono text-xs text-zinc-500">
                      {formatDateTime(entry.createdAt)}
                    </td>
                    <td className="px-3 py-2 text-xs">{userById.get(entry.userId)?.email ?? "—"}</td>
                    <td className="px-3 py-2">{actionLabel(entry.action)}</td>
                    <td className="px-3 py-2">
                      <MetadataSummary metadata={entry.metadata} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
                disabled={entries.length < PAGE_SIZE}
                onClick={() => setPage((p) => p + 1)}
                className="rounded-md border px-3 py-1 text-xs font-medium hover:bg-zinc-50 disabled:opacity-40 dark:hover:bg-zinc-800"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
