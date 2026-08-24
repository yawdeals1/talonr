import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router";
import { listAccounts } from "../api/accounts";
import { listScrapes } from "../api/scrapes";
import type { ScrapeJob, XAccountStatus } from "../api/types";
import { EmptyState } from "../components/EmptyState";
import { SkeletonCards, SkeletonRows } from "../components/Skeleton";
import { StatPill } from "../components/StatPill";
import { StatusPill } from "../components/StatusPill";
import { StatTile } from "../components/StatTile";
import { formatNumber, formatRelative, isToday } from "../lib/format";

export function Dashboard() {
  const navigate = useNavigate();
  const accountsQuery = useQuery({ queryKey: ["accounts"], queryFn: listAccounts });
  const scrapesQuery = useQuery({ queryKey: ["scrapes"], queryFn: () => listScrapes() });

  const isLoading = accountsQuery.isLoading || scrapesQuery.isLoading;
  const accounts = accountsQuery.data?.accounts ?? [];
  const scrapeJobs = scrapesQuery.data?.scrapeJobs ?? [];

  if (isLoading) {
    return (
      <div className="space-y-6">
        <SkeletonCards count={4} />
        <SkeletonRows rows={5} cols={5} />
      </div>
    );
  }

  if (accounts.length === 0) {
    return (
      <EmptyState
        title="No X accounts connected yet"
        description="Connect your first X account to start scraping leads."
        action={
          <Link
            to="/accounts"
            className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            Connect an account
          </Link>
        }
      />
    );
  }

  const statusCounts = accounts.reduce<Record<XAccountStatus, number>>(
    (acc, a) => {
      acc[a.status]++;
      return acc;
    },
    { active: 0, checkpointed: 0, banned: 0 }
  );

  const totalLeadsScraped = scrapeJobs.reduce((sum, j) => sum + j.leadsFound, 0);
  const todaysJobs = scrapeJobs.filter((j) => isToday(j.createdAt));
  const scrapesToday = todaysJobs.length;
  const leadsFoundToday = todaysJobs.reduce((sum, j) => sum + j.leadsFound, 0);

  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const recentJobs = scrapeJobs.slice(0, 10);
  const runningJob = scrapeJobs.find((j) => j.status === "running");

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
            Operator Dashboard
          </h1>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            Real-time status overview of lead collection, scrapes, and X account session health.
          </p>
        </div>
        <Link
          to="/scrapes/new"
          className="inline-flex items-center justify-center gap-2 rounded-md bg-accent px-4 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          <span>Trigger New Scrape</span>
        </Link>
      </div>

      {/* Live Running Banner */}
      {runningJob && (
        <div className="flex items-center justify-between rounded-lg border border-blue-500/20 bg-blue-500/10 px-4 py-3 text-xs text-blue-700 dark:text-blue-300">
          <div className="flex items-center gap-3">
            <span className="h-2 w-2 rounded-full bg-blue-500 animate-pulse-dot" />
            <span className="font-semibold">Scrape Job in Progress:</span>
            <span className="font-mono text-xs">{runningJob.sourceType} · {runningJob.sourceRef}</span>
          </div>
          <Link
            to={`/scrapes/${runningJob.id}`}
            className="font-mono text-xs font-semibold underline hover:opacity-80"
          >
            View Job Progress →
          </Link>
        </div>
      )}

      {/* Metric Tiles */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          label="Connected accounts"
          value={formatNumber(accounts.length)}
          sub={
            <div className="flex items-center gap-2">
              <StatPill count={statusCounts.active} label="active" tone="success" />
              <span className="text-zinc-300 dark:text-zinc-700">•</span>
              <StatPill count={statusCounts.checkpointed} label="paused" tone="warning" />
              <span className="text-zinc-300 dark:text-zinc-700">•</span>
              <StatPill count={statusCounts.banned} label="banned" tone="danger" />
            </div>
          }
        />
        <StatTile label="Total leads scraped" value={formatNumber(totalLeadsScraped)} />
        <StatTile label="Scrapes today" value={formatNumber(scrapesToday)} />
        <StatTile label="Leads found today" value={formatNumber(leadsFoundToday)} />
      </div>

      {/* Recent Scrape Jobs */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Recent Scrape Jobs
          </h2>
          <Link to="/scrapes" className="font-mono text-xs font-medium text-amber-700 hover:underline dark:text-amber-400">
            View all scrapes →
          </Link>
        </div>

        {recentJobs.length === 0 ? (
          <EmptyState
            title="No scrapes yet"
            description="Trigger your first scrape to start collecting leads."
            action={
              <Link
                to="/scrapes/new"
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
              >
                Trigger scrape
              </Link>
            }
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border bg-white dark:bg-zinc-950 dark:border-zinc-800">
            <table className="w-full text-left text-xs">
              <thead className="border-b bg-zinc-50 font-mono text-[11px] uppercase tracking-wider text-zinc-500 dark:bg-zinc-900/60 dark:border-zinc-800 dark:text-zinc-400">
                <tr>
                  <th className="px-3.5 py-2.5 font-medium">Source</th>
                  <th className="px-3.5 py-2.5 font-medium">Reference</th>
                  <th className="px-3.5 py-2.5 font-medium">Account</th>
                  <th className="px-3.5 py-2.5 font-medium">Status</th>
                  <th className="px-3.5 py-2.5 font-medium">Leads</th>
                  <th className="px-3.5 py-2.5 font-medium">Started</th>
                </tr>
              </thead>
              <tbody className="divide-y dark:divide-zinc-800/60">
                {recentJobs.map((job: ScrapeJob) => (
                  <tr
                    key={job.id}
                    className="cursor-pointer transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900/50"
                    onClick={() => navigate(`/scrapes/${job.id}`)}
                  >
                    <td className="px-3.5 py-2.5 font-medium">
                      <span className="inline-flex rounded border bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px] uppercase dark:bg-zinc-800 dark:border-zinc-700">
                        {job.sourceType}
                      </span>
                    </td>
                    <td className="max-w-[200px] truncate px-3.5 py-2.5 font-mono text-zinc-900 dark:text-zinc-100">
                      {job.sourceRef}
                    </td>
                    <td className="px-3.5 py-2.5 font-mono text-amber-700 dark:text-amber-400">
                      @{accountById.get(job.xAccountId)?.handle ?? "—"}
                    </td>
                    <td className="px-3.5 py-2.5">
                      <StatusPill status={job.status} />
                    </td>
                    <td className="px-3.5 py-2.5 font-mono font-medium text-zinc-900 dark:text-zinc-100">
                      {formatNumber(job.leadsFound)}
                    </td>
                    <td className="px-3.5 py-2.5 font-mono text-zinc-500 dark:text-zinc-400">
                      {job.startedAt ? formatRelative(job.startedAt) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Connected Accounts Grid */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Connected X Accounts
          </h2>
          <Link to="/accounts" className="font-mono text-xs font-medium text-amber-700 hover:underline dark:text-amber-400">
            Manage accounts →
          </Link>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {accounts.map((account) => (
            <Link
              key={account.id}
              to="/accounts"
              className="flex items-center justify-between rounded-lg border bg-zinc-50/50 p-3.5 transition-colors hover:border-zinc-300 dark:bg-zinc-900/40 dark:hover:border-zinc-700"
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm font-bold text-zinc-900 dark:text-zinc-100">
                  @{account.handle}
                </span>
              </div>
              <StatusPill status={account.status} />
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
