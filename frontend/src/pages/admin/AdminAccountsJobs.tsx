import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { listAllScrapeJobs, listUserAccounts, listUsers } from "../../api/admin";
import type { ScrapeJobStatus } from "../../api/types";
import { EmptyState } from "../../components/EmptyState";
import { SkeletonRows } from "../../components/Skeleton";
import { StatusPill } from "../../components/StatusPill";
import { formatDateTime, formatNumber, formatRelative } from "../../lib/format";

const STATUS_OPTIONS: ScrapeJobStatus[] = ["queued", "running", "completed", "failed", "paused"];

export function AdminAccountsJobs() {
  const [params, setParams] = useSearchParams();
  const userId = params.get("userId") ?? "";
  const status = (params.get("status") as ScrapeJobStatus | null) ?? "";

  const usersQuery = useQuery({ queryKey: ["admin", "users"], queryFn: listUsers });
  const users = usersQuery.data?.users ?? [];
  const userById = new Map(users.map((u) => [u.id, u]));

  const accountsQuery = useQuery({
    queryKey: ["admin", "userAccounts", userId],
    queryFn: () => listUserAccounts(userId),
    enabled: !!userId,
  });

  const jobsQuery = useQuery({
    queryKey: ["admin", "scrapeJobs", { userId, status }],
    queryFn: () => listAllScrapeJobs({ userId: userId || undefined, status: status || undefined }),
  });

  function updateParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
  }

  const jobs = jobsQuery.data?.scrapeJobs ?? [];
  const accounts = accountsQuery.data?.accounts ?? [];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Accounts & Jobs</h1>
        <div className="mt-3 flex flex-wrap gap-3">
          <select
            value={userId}
            onChange={(e) => updateParam("userId", e.target.value)}
            className="rounded-md border bg-transparent px-3 py-1.5 text-sm text-zinc-900 outline-none focus:border-accent dark:text-zinc-100"
          >
            <option value="" className="bg-white text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100">
              All users (jobs only)
            </option>
            {users.map((u) => (
              <option key={u.id} value={u.id} className="bg-white text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100">
                {u.email}
              </option>
            ))}
          </select>
          <select
            value={status}
            onChange={(e) => updateParam("status", e.target.value)}
            className="rounded-md border bg-transparent px-3 py-1.5 text-sm text-zinc-900 outline-none focus:border-accent dark:text-zinc-100"
          >
            <option value="" className="bg-white text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100">
              All statuses
            </option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s} className="bg-white text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100">
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">X Accounts</h2>
        {!userId ? (
          <EmptyState title="Select a user" description="Choose a user above to view their X accounts." />
        ) : accountsQuery.isLoading ? (
          <SkeletonRows rows={3} cols={5} />
        ) : accounts.length === 0 ? (
          <EmptyState title="This user has no X accounts" />
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="border-b bg-zinc-50 text-left text-xs text-zinc-500 dark:bg-zinc-900/40">
                <tr>
                  <th className="px-3 py-2 font-medium">Handle</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Daily limit</th>
                  <th className="px-3 py-2 font-medium">Max concurrency</th>
                  <th className="px-3 py-2 font-medium">Last used</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.id} className="border-b last:border-0">
                    <td className="px-3 py-2 font-mono text-xs">@{a.handle}</td>
                    <td className="px-3 py-2">
                      <StatusPill status={a.status} />
                    </td>
                    <td className="px-3 py-2 font-mono">{a.dailyScrapeLimit}</td>
                    <td className="px-3 py-2 font-mono">{a.maxConcurrency}</td>
                    <td className="px-3 py-2 text-xs text-zinc-500">
                      {a.lastUsedAt ? formatDateTime(a.lastUsedAt) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">Scrape Jobs</h2>
        {jobsQuery.isLoading ? (
          <SkeletonRows rows={6} cols={6} />
        ) : jobs.length === 0 ? (
          <EmptyState title="No scrape jobs match these filters" />
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="border-b bg-zinc-50 text-left text-xs text-zinc-500 dark:bg-zinc-900/40">
                <tr>
                  <th className="px-3 py-2 font-medium">User</th>
                  <th className="px-3 py-2 font-medium">Source</th>
                  <th className="px-3 py-2 font-medium">Reference</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Leads</th>
                  <th className="px-3 py-2 font-medium">Started</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id} className="border-b last:border-0">
                    <td className="px-3 py-2 text-xs text-zinc-500">{userById.get(job.userId)?.email ?? "—"}</td>
                    <td className="px-3 py-2 capitalize">{job.sourceType}</td>
                    <td className="max-w-[200px] truncate px-3 py-2 font-mono text-xs" title={job.sourceRef}>
                      {job.sourceRef}
                    </td>
                    <td className="px-3 py-2">
                      <StatusPill status={job.status} />
                    </td>
                    <td className="px-3 py-2 font-mono">{formatNumber(job.leadsFound)}</td>
                    <td className="px-3 py-2 text-xs text-zinc-500">
                      {job.startedAt ? formatRelative(job.startedAt) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
