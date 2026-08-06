import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { listUsers } from "../../api/admin";
import { EmptyState } from "../../components/EmptyState";
import { SkeletonRows } from "../../components/Skeleton";
import { formatDateTime } from "../../lib/format";

export function AdminUsers() {
  const navigate = useNavigate();
  const query = useQuery({ queryKey: ["admin", "users"], queryFn: listUsers });
  const users = query.data?.users ?? [];

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Users</h1>

      {query.isLoading ? (
        <SkeletonRows rows={8} cols={3} />
      ) : users.length === 0 ? (
        <EmptyState title="No users yet" />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="border-b bg-zinc-50 text-left text-xs text-zinc-500 dark:bg-zinc-900/40">
              <tr>
                <th className="px-3 py-2 font-medium">Email</th>
                <th className="px-3 py-2 font-medium">Role</th>
                <th className="px-3 py-2 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr
                  key={u.id}
                  className="cursor-pointer border-b last:border-0 hover:bg-zinc-50 dark:hover:bg-zinc-900/40"
                  onClick={() => navigate(`/admin/accounts-jobs?userId=${u.id}`)}
                >
                  <td className="px-3 py-2">{u.email}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[11px] font-medium uppercase ${
                        u.role === "admin"
                          ? "bg-accent/10 text-accent-text"
                          : "bg-status-neutral-bg text-status-neutral"
                      }`}
                    >
                      {u.role}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-zinc-500">{formatDateTime(u.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
