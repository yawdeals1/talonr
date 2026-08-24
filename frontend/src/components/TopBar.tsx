import { useLocation, useNavigate } from "react-router";
import { useAuth } from "../context/AuthContext";
import { ThemeToggle } from "./ThemeToggle";

const ROUTE_LABELS: Record<string, string> = {
  "/": "Dashboard",
  "/accounts": "X Accounts",
  "/scrapes": "Scrapes",
  "/scrapes/new": "Trigger Scrape",
  "/leads": "Leads Browser",
  "/lead-lists": "Lead Lists",
  "/lead-lists/new": "New Lead List",
  "/admin/users": "Admin / Users",
  "/admin/accounts-jobs": "Admin / Accounts & Jobs",
  "/admin/activity": "Admin / Activity Log",
};

export function TopBar({ onOpenMobileNav }: { onOpenMobileNav: () => void }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  async function handleLogout() {
    await logout();
    navigate("/login");
  }

  const currentTitle = ROUTE_LABELS[location.pathname] ?? "Console";

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b bg-white px-4 md:px-6 dark:bg-zinc-950 dark:border-zinc-800">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onOpenMobileNav}
          aria-label="Open navigation"
          className="-m-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 md:hidden dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
        >
          <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5">
            <path stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" d="M3 6h14M3 10h14M3 14h14" />
          </svg>
        </button>

        <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
          <span className="font-mono font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
            Talonr
          </span>
          <span>/</span>
          <span className="font-semibold text-zinc-900 dark:text-zinc-100">{currentTitle}</span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <span className="hidden items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-0.5 font-mono text-[11px] font-medium text-emerald-600 sm:flex dark:text-emerald-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
          <span>API: HEALTHY</span>
        </span>

        <ThemeToggle />

        {user?.role === "admin" && (
          <span className="rounded bg-amber-500/10 px-2 py-0.5 font-mono text-[10px] font-bold tracking-wider text-amber-600 uppercase dark:text-amber-400">
            Admin
          </span>
        )}

        <div className="hidden h-4 w-px bg-zinc-200 sm:block dark:bg-zinc-800" />

        <span className="hidden font-mono text-xs text-zinc-600 sm:inline dark:text-zinc-400">
          {user?.email}
        </span>

        <button
          type="button"
          onClick={handleLogout}
          className="rounded-md border px-2.5 py-1 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
        >
          Log out
        </button>
      </div>
    </header>
  );
}
