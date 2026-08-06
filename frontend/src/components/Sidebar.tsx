import { NavLink } from "react-router";
import { useAuth } from "../context/AuthContext";
import { useDialogA11y } from "../lib/useDialogA11y";

const NAV_ITEMS = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/accounts", label: "X Accounts" },
  { to: "/scrapes", label: "Scrapes" },
  { to: "/leads", label: "Leads" },
  { to: "/lead-lists", label: "Lead Lists" },
];

const ADMIN_NAV_ITEMS = [
  { to: "/admin/users", label: "Users" },
  { to: "/admin/accounts-jobs", label: "Accounts & Jobs" },
  { to: "/admin/activity", label: "Activity" },
];

function navLinkClass({ isActive }: { isActive: boolean }): string {
  return [
    "block rounded-md px-3 py-2 text-sm font-medium transition-colors",
    isActive
      ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-900 dark:text-zinc-50"
      : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900/60 dark:hover:text-zinc-100",
  ].join(" ");
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { user } = useAuth();

  return (
    <>
      <div className="flex h-14 items-center px-4">
        <span className="font-mono text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          talonr
        </span>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-2">
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} className={navLinkClass} onClick={onNavigate}>
            {item.label}
          </NavLink>
        ))}

        {user?.role === "admin" && (
          <div className="pt-4">
            <p className="px-3 pb-1 font-mono text-[11px] font-medium tracking-wide text-zinc-400 uppercase dark:text-zinc-600">
              Admin
            </p>
            {ADMIN_NAV_ITEMS.map((item) => (
              <NavLink key={item.to} to={item.to} className={navLinkClass} onClick={onNavigate}>
                {item.label}
              </NavLink>
            ))}
          </div>
        )}
      </nav>
    </>
  );
}

/** Persistent on tablet/desktop (>=768px). Rendered separately from the mobile drawer below. */
export function Sidebar() {
  return (
    <aside className="hidden w-sidebar shrink-0 flex-col border-r bg-zinc-50 md:flex dark:bg-zinc-900/40">
      <SidebarContent />
    </aside>
  );
}

/** Slide-in drawer for mobile (<768px), triggered by TopBar's hamburger button. */
export function MobileSidebarDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { titleId, panelRef } = useDialogA11y(onClose);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 md:hidden" role="presentation">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative flex h-full w-64 flex-col border-r bg-zinc-50 outline-none dark:bg-zinc-900"
      >
        <span id={titleId} className="sr-only">
          Navigation
        </span>
        <SidebarContent onNavigate={onClose} />
      </aside>
    </div>
  );
}
