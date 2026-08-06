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
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
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

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          label="Connected accounts"
          value={formatNumber(accounts.length)}
          sub={
            <div className="flex gap-2">
              <StatPill count={statusCounts.active} label="active" tone="success" />
              <StatPill count={statusCounts.checkpointed} label="paused" tone="warning" />
              <StatPill count={statusCounts.banned} label="banned" tone="danger" />
            </div>
          }
        />
        <StatTile label="Total leads scraped" value={formatNumber(totalLeadsScraped)} />
        <StatTile label="Scrapes today" value={formatNumber(scrapesToday)} />
        <StatTile label="Leads found today" value={formatNumber(leadsFoundToday)} />
      </div>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Recent scrape jobs</h2>
          <Link to="/scrapes" className="text-xs font-medium text-accent-text hover:underline">
            View all
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
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="border-b bg-zinc-50 text-left text-xs text-zinc-500 dark:bg-zinc-900/40">
                <tr>
                  <th className="px-3 py-2 font-medium">Source</th>
                  <th className="px-3 py-2 font-medium">Account</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Leads</th>
                  <th className="px-3 py-2 font-medium">Started</th>
                </tr>
              </thead>
              <tbody>
                {recentJobs.map((job: ScrapeJob) => (
                  <tr
                    key={job.id}
                    className="cursor-pointer border-b last:border-0 hover:bg-zinc-50 dark:hover:bg-zinc-900/40"
                    onClick={() => navigate(`/scrapes/${job.id}`)}
                  >
                    <td className="px-3 py-2 capitalize">{job.sourceType}</td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {accountById.get(job.xAccountId)?.handle ?? "—"}
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

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Connected accounts</h2>
          <Link to="/accounts" className="text-xs font-medium text-accent-text hover:underline">
            Manage
          </Link>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {accounts.map((account) => (
            <Link
              key={account.id}
              to="/accounts"
              className="flex items-center justify-between rounded-lg border p-3 hover:bg-zinc-50 dark:hover:bg-zinc-900/40"
            >
              <span className="font-mono text-sm">@{account.handle}</span>
              <StatusPill status={account.status} />
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
