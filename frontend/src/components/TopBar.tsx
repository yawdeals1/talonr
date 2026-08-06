import { useNavigate } from "react-router";
import { useAuth } from "../context/AuthContext";
import { ThemeToggle } from "./ThemeToggle";

export function TopBar({ onOpenMobileNav }: { onOpenMobileNav: () => void }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate("/login");
  }

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4 md:px-6">
      <button
        type="button"
        onClick={onOpenMobileNav}
        aria-label="Open navigation"
        className="-m-2.5 flex h-11 w-11 shrink-0 items-center justify-center text-zinc-500 hover:text-zinc-800 md:hidden dark:hover:text-zinc-200"
      >
        <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5">
          <path stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" d="M3 6h14M3 10h14M3 14h14" />
        </svg>
      </button>

      <div className="flex flex-1 items-center justify-end gap-3">
        <ThemeToggle />
        {user?.role === "admin" && (
          <span className="rounded-full bg-accent/10 px-2 py-0.5 font-mono text-[11px] font-medium text-accent-text uppercase">
            Admin
          </span>
        )}
        <span className="hidden font-mono text-sm text-zinc-600 sm:inline dark:text-zinc-400">
          {user?.email}
        </span>
        <button
          type="button"
          onClick={handleLogout}
          className="rounded-md border px-3 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-900"
        >
          Log out
        </button>
      </div>
    </header>
  );
}
