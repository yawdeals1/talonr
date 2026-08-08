import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState, type FormEvent } from "react";
import { createAccount, deleteAccount, getConnectToken, listAccounts, updateAccount } from "../api/accounts";
import { absoluteApiUrl, ApiError } from "../api/client";
import { listScrapes } from "../api/scrapes";
import type { XAccount, XAccountStatus } from "../api/types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { EmptyState } from "../components/EmptyState";
import { Modal } from "../components/Modal";
import { SkeletonCards } from "../components/Skeleton";
import { StatusPill } from "../components/StatusPill";
import { formatDateTime } from "../lib/format";

function checkpointReasonFor(account: XAccount, jobs: { xAccountId: string; status: string; errorMessage: string | null }[]): string | null {
  if (account.status !== "checkpointed") return null;
  const relevant = jobs.find(
    (j) => j.xAccountId === account.id && (j.status === "failed" || j.status === "paused") && j.errorMessage
  );
  return relevant?.errorMessage ?? null;
}

export function XAccounts() {
  const queryClient = useQueryClient();

  const accountsQuery = useQuery({ queryKey: ["accounts"], queryFn: listAccounts });
  const scrapesQuery = useQuery({ queryKey: ["scrapes"], queryFn: () => listScrapes() });

  const [showConnect, setShowConnect] = useState(false);
  const [justConnected, setJustConnected] = useState<XAccount | null>(null);
  const [editing, setEditing] = useState<XAccount | null>(null);
  const [deleting, setDeleting] = useState<XAccount | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["accounts"] });

  const createMutation = useMutation({
    mutationFn: createAccount,
    onSuccess: ({ account }) => {
      invalidate();
      setShowConnect(false);
      setJustConnected(account);
    },
  });

  const updateMutation = useMutation({
    mutationFn: (input: { id: string; dailyScrapeLimit?: number; maxConcurrency?: number; status?: XAccountStatus }) =>
      updateAccount(input.id, input),
    onSuccess: () => {
      invalidate();
      setEditing(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteAccount,
    onSuccess: () => {
      invalidate();
      setDeleting(null);
    },
  });

  if (accountsQuery.isLoading) {
    return <SkeletonCards count={4} />;
  }

  const accounts = accountsQuery.data?.accounts ?? [];
  const jobs = scrapesQuery.data?.scrapeJobs ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">X Accounts</h1>
        <button
          type="button"
          onClick={() => setShowConnect(true)}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          Connect Account
        </button>
      </div>

      {accounts.length === 0 ? (
        <EmptyState
          title="No X accounts yet"
          description="Connect an account to start running scrapes."
          action={
            <button
              type="button"
              onClick={() => setShowConnect(true)}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              Connect Account
            </button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {accounts.map((account) => {
            const reason = checkpointReasonFor(account, jobs);
            return (
              <div key={account.id} className="flex flex-col gap-3 rounded-lg border p-4">
                <div className="flex items-start justify-between">
                  <span className="font-mono text-sm font-medium">@{account.handle}</span>
                  <StatusPill status={account.status} />
                </div>

                {!account.hasSession && (
                  <p className="text-xs text-status-warning">Not connected yet — session not captured.</p>
                )}

                {(!account.hasSession || reason) && (
                  <button
                    type="button"
                    onClick={() => setJustConnected(account)}
                    className="rounded-md border border-accent px-2 py-1.5 text-xs font-medium text-accent hover:bg-accent/10"
                  >
                    {reason ? "Reconnect" : "Finish connecting"}
                  </button>
                )}

                {reason && (
                  <p className="rounded border border-status-warning-bg bg-status-warning-bg px-2 py-1 text-xs text-status-warning">
                    {reason}
                  </p>
                )}

                <dl className="grid grid-cols-2 gap-x-2 gap-y-1 text-xs text-zinc-500">
                  <dt>Daily limit</dt>
                  <dd className="text-right font-mono">{account.dailyScrapeLimit}</dd>
                  <dt>Max concurrency</dt>
                  <dd className="text-right font-mono">{account.maxConcurrency}</dd>
                  <dt>Last used</dt>
                  <dd className="text-right font-mono">
                    {account.lastUsedAt ? formatDateTime(account.lastUsedAt) : "—"}
                  </dd>
                </dl>

                <div className="mt-auto flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setEditing(account)}
                    className="flex-1 rounded-md border px-2 py-1.5 text-xs font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleting(account)}
                    className="flex-1 rounded-md border px-2 py-1.5 text-xs font-medium text-status-danger hover:bg-status-danger-bg"
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showConnect && (
        <ConnectAccountModal
          onClose={() => setShowConnect(false)}
          onSubmit={(input) => createMutation.mutate(input)}
          error={createMutation.error instanceof ApiError ? createMutation.error.message : null}
          submitting={createMutation.isPending}
        />
      )}

      {justConnected && (
        <FinishConnectingModal account={justConnected} onClose={() => setJustConnected(null)} />
      )}

      {editing && (
        <EditAccountModal
          account={editing}
          onClose={() => setEditing(null)}
          onSubmit={(input) => updateMutation.mutate({ id: editing.id, ...input })}
          error={updateMutation.error instanceof ApiError ? updateMutation.error.message : null}
          submitting={updateMutation.isPending}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete account?"
          message={`This permanently deletes @${deleting.handle} and cascades to its scrape jobs. This can't be undone.`}
          onConfirm={() => deleteMutation.mutate(deleting.id)}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  );
}

function ConnectAccountModal({
  onClose,
  onSubmit,
  error,
  submitting,
}: {
  onClose: () => void;
  onSubmit: (input: { handle: string; dailyScrapeLimit?: number; maxConcurrency?: number }) => void;
  error: string | null;
  submitting: boolean;
}) {
  const [handle, setHandle] = useState("");
  const [dailyScrapeLimit, setDailyScrapeLimit] = useState("");
  const [maxConcurrency, setMaxConcurrency] = useState("");
  const idPrefix = useId();

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSubmit({
      handle: handle.replace(/^@/, ""),
      dailyScrapeLimit: dailyScrapeLimit ? Number(dailyScrapeLimit) : undefined,
      maxConcurrency: maxConcurrency ? Number(maxConcurrency) : undefined,
    });
  }

  return (
    <Modal title="Connect Account" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label
            htmlFor={`${idPrefix}-handle`}
            className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
          >
            X handle
          </label>
          <input
            id={`${idPrefix}-handle`}
            required
            placeholder="handle (without @)"
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label
              htmlFor={`${idPrefix}-daily-limit`}
              className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
            >
              Daily limit
            </label>
            <input
              id={`${idPrefix}-daily-limit`}
              type="number"
              min={1}
              placeholder="150"
              value={dailyScrapeLimit}
              onChange={(e) => setDailyScrapeLimit(e.target.value)}
              className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </div>
          <div>
            <label
              htmlFor={`${idPrefix}-max-concurrency`}
              className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
            >
              Max concurrency
            </label>
            <input
              id={`${idPrefix}-max-concurrency`}
              type="number"
              min={1}
              placeholder="1"
              value={maxConcurrency}
              onChange={(e) => setMaxConcurrency(e.target.value)}
              className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </div>
        </div>
        {error && <p className="text-sm text-status-danger">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-accent py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? "Adding…" : "Add account"}
        </button>
      </form>
    </Modal>
  );
}

type LoginOs = "windows" | "unix";

function detectOs(): LoginOs {
  return typeof navigator !== "undefined" && navigator.userAgent.includes("Windows") ? "windows" : "unix";
}

// A separate "download the file" step relies on the user knowing where their browser saves
// downloads and remembering to cd there before running the next command — that mismatch (browser
// Downloads folder vs. wherever the terminal happens to be) is exactly what broke this in
// practice. Instead, one pasteable command fetches the script into a fixed folder and immediately
// runs it from that same folder, so there's no location to keep track of.
function buildLoginCommand(
  os: LoginOs,
  scriptUrl: string,
  endpoint: string,
  token: string,
  handle: string,
  importCookies: boolean
): string {
  // login.ts has a static `import { chromium } from "playwright"` at the top regardless of mode,
  // so `npm install playwright` always has to run. Only the browser *binary* download (slow, and
  // genuinely unused in cookie-import mode since no browser is launched) is safe to skip.
  const runArgs = `--endpoint "${endpoint}" --token "${token}" --handle "${handle}"${importCookies ? " --import-cookies" : ""}`;
  if (os === "windows") {
    return (
      `mkdir -Force "$env:USERPROFILE\\talonr-login" | Out-Null; ` +
      `cd "$env:USERPROFILE\\talonr-login"; ` +
      `Invoke-WebRequest -Uri "${scriptUrl}" -OutFile talonr-login.ts; ` +
      `npm install playwright; ` +
      (importCookies ? "" : `npx playwright install chrome; `) +
      `npx --yes tsx talonr-login.ts ${runArgs}`
    );
  }
  return (
    `mkdir -p ~/talonr-login && cd ~/talonr-login && ` +
    `curl -fsSL "${scriptUrl}" -o talonr-login.ts && ` +
    `npm install playwright && ` +
    (importCookies ? "" : `npx playwright install chrome && `) +
    `npx --yes tsx talonr-login.ts ${runArgs}`
  );
}

function FinishConnectingModal({ account, onClose }: { account: XAccount; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const [os, setOs] = useState<LoginOs>(detectOs);
  const [importCookies, setImportCookies] = useState(false);
  const tokenQuery = useQuery({
    queryKey: ["connect-token", account.id],
    queryFn: () => getConnectToken(account.id),
    staleTime: 0,
    gcTime: 0,
  });

  const scriptUrl = absoluteApiUrl("/accounts/login-script");
  const endpoint = absoluteApiUrl("/accounts/session");
  const command = tokenQuery.data
    ? buildLoginCommand(os, scriptUrl, endpoint, tokenQuery.data.token, account.handle, importCookies)
    : null;

  return (
    <Modal title="Finish connecting" onClose={onClose}>
      <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">
        @{account.handle} has been added, but its X session hasn't been captured yet. X's login can't be
        automated (2FA/captchas), so this runs on your own machine — it only needs Node.js and Playwright,
        not this project's source or server secrets. Paste the one command below into a terminal; it
        downloads a small script and opens a browser window for you to log in as @{account.handle}.
      </p>

      <p className="mb-3 rounded border border-status-warning-bg bg-status-warning-bg px-2 py-1.5 text-xs text-status-warning">
        In that window, log in with your X <strong>username/password</strong> — not "Continue with Google".
        Google blocks automated browser sessions outright and that button will fail. If this account only
        has Google sign-in, set an X password first in a normal browser (Settings → Your account → Change
        password), then come back and use that.
      </p>

      <div className="mb-2 flex gap-1 text-xs">
        <button
          type="button"
          onClick={() => setOs("windows")}
          className={`rounded border px-2 py-1 font-medium ${os === "windows" ? "border-accent text-accent" : "hover:bg-zinc-50 dark:hover:bg-zinc-800"}`}
        >
          Windows (PowerShell)
        </button>
        <button
          type="button"
          onClick={() => setOs("unix")}
          className={`rounded border px-2 py-1 font-medium ${os === "unix" ? "border-accent text-accent" : "hover:bg-zinc-50 dark:hover:bg-zinc-800"}`}
        >
          macOS / Linux
        </button>
      </div>

      <label className="mb-3 flex items-start gap-2 text-xs text-zinc-600 dark:text-zinc-400">
        <input
          type="checkbox"
          checked={importCookies}
          onChange={(e) => setImportCookies(e.target.checked)}
          className="mt-0.5"
        />
        <span>
          X blocked the automated login (Continue does nothing, or DevTools shows errors around{" "}
          <code className="font-mono">arkoselabs.com</code>/<code className="font-mono">socure.io</code>)? Use
          cookie import instead — no browser gets automated at all.
        </span>
      </label>

      {importCookies && (
        <p className="mb-3 rounded border border-status-warning-bg bg-status-warning-bg px-2 py-1.5 text-xs text-status-warning">
          The command will prompt you to paste cookie values. Get them from a regular (non-automated) browser
          you're already logged into X with: DevTools (F12) → Application tab → Cookies →{" "}
          <code className="font-mono">https://x.com</code>. You need <code className="font-mono">auth_token</code>{" "}
          and <code className="font-mono">ct0</code> — <code className="font-mono">twid</code> and{" "}
          <code className="font-mono">guest_id</code> are optional. Only those specific values are read.
        </p>
      )}

      {tokenQuery.isLoading && <p className="mb-3 text-xs text-zinc-500">Generating a connect token…</p>}
      {tokenQuery.isError && (
        <p className="mb-3 text-xs text-status-danger">
          Couldn't generate a connect token — close and reopen this dialog to retry.
        </p>
      )}

      {command && tokenQuery.data && (
        <>
          <div className="mb-1 flex items-start justify-between gap-2 rounded-md border bg-zinc-50 px-3 py-2 font-mono text-xs dark:bg-zinc-800">
            <code className="overflow-x-auto whitespace-pre-wrap break-all">{command}</code>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(command);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="shrink-0 rounded border px-2 py-1 text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-700"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="mb-4 text-xs text-zinc-500">
            This token expires at {new Date(tokenQuery.data.expiresAt).toLocaleTimeString()} and only authorizes
            writing back a session for this account — reopen this dialog for a fresh one if it lapses. Once you
            complete login in the opened window, this account flips to "active" automatically.
          </p>
        </>
      )}

      <button
        type="button"
        onClick={onClose}
        className="w-full rounded-md border py-2 text-sm font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800"
      >
        Done
      </button>
    </Modal>
  );
}

function EditAccountModal({
  account,
  onClose,
  onSubmit,
  error,
  submitting,
}: {
  account: XAccount;
  onClose: () => void;
  onSubmit: (input: { dailyScrapeLimit?: number; maxConcurrency?: number; status?: XAccountStatus }) => void;
  error: string | null;
  submitting: boolean;
}) {
  const [dailyScrapeLimit, setDailyScrapeLimit] = useState(String(account.dailyScrapeLimit));
  const [maxConcurrency, setMaxConcurrency] = useState(String(account.maxConcurrency));
  const [status, setStatus] = useState<XAccountStatus>(account.status);
  const idPrefix = useId();

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSubmit({
      dailyScrapeLimit: Number(dailyScrapeLimit),
      maxConcurrency: Number(maxConcurrency),
      status,
    });
  }

  return (
    <Modal title={`Edit @${account.handle}`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label
              htmlFor={`${idPrefix}-daily-limit`}
              className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
            >
              Daily limit
            </label>
            <input
              id={`${idPrefix}-daily-limit`}
              type="number"
              min={1}
              value={dailyScrapeLimit}
              onChange={(e) => setDailyScrapeLimit(e.target.value)}
              className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </div>
          <div>
            <label
              htmlFor={`${idPrefix}-max-concurrency`}
              className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
            >
              Max concurrency
            </label>
            <input
              id={`${idPrefix}-max-concurrency`}
              type="number"
              min={1}
              value={maxConcurrency}
              onChange={(e) => setMaxConcurrency(e.target.value)}
              className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </div>
        </div>
        <div>
          <label
            htmlFor={`${idPrefix}-status`}
            className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
          >
            Status
          </label>
          <select
            id={`${idPrefix}-status`}
            value={status}
            onChange={(e) => setStatus(e.target.value as XAccountStatus)}
            className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus:border-accent"
          >
            <option value="active">active</option>
            <option value="checkpointed">checkpointed</option>
            <option value="banned">banned</option>
          </select>
        </div>
        {error && <p className="text-sm text-status-danger">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-accent py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? "Saving…" : "Save changes"}
        </button>
      </form>
    </Modal>
  );
}
