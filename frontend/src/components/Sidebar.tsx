import { Link, NavLink } from "react-router";
import { useAuth } from "../context/AuthContext";
import { useDialogA11y } from "../lib/useDialogA11y";

const NAV_ITEMS = [
  {
    to: "/",
    label: "Dashboard",
    end: true,
    icon: (
      <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
      </svg>
    ),
  },
  {
    to: "/accounts",
    label: "X Accounts",
    icon: (
      <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
      </svg>
    ),
  },
  {
    to: "/scrapes",
    label: "Scrapes",
    icon: (
      <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
      </svg>
    ),
  },
  {
    to: "/leads",
    label: "Leads",
    icon: (
      <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a5.97 5.97 0 00-.942 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
      </svg>
    ),
  },
  {
    to: "/lead-lists",
    label: "Lead Lists",
    icon: (
      <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75zm0 5.25h.007v.008H3.75V12zm0 5.25h.007v.008H3.75v-.008z" />
      </svg>
    ),
  },
];

const ADMIN_NAV_ITEMS = [
  {
    to: "/admin/users",
    label: "Users",
    icon: (
      <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
      </svg>
    ),
  },
  {
    to: "/admin/accounts-jobs",
    label: "Accounts & Jobs",
    icon: (
      <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 14.25h13.5m-13.5 0a3 3 0 01-3-3m3 3a3 3 0 100 6h13.5a3 3 0 100-6m-16.5-3a3 3 0 013-3h13.5a3 3 0 013 3m-19.5 0a3 3 0 003 3h13.5a3 3 0 003-3M6.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm0 6a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
      </svg>
    ),
  },
  {
    to: "/admin/activity",
    label: "Activity Log",
    icon: (
      <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
];

function navLinkClass({ isActive }: { isActive: boolean }): string {
  return [
    "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
    isActive
      ? "bg-zinc-200/70 text-zinc-900 font-semibold border-l-2 border-accent dark:bg-zinc-800 dark:text-zinc-50"
      : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900/80 dark:hover:text-zinc-100",
  ].join(" ");
}
function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { user } = useAuth();

  return (
    <div className="flex h-full flex-col justify-between">
      <div>
        <div className="flex h-14 items-center justify-between border-b px-4 dark:border-zinc-800">
          <div className="flex items-center gap-2.5">
            <img src="/icon.png" alt="" className="h-6 w-6 object-contain dark:hidden" />
            <img src="/icon-dark.png" alt="" className="hidden h-6 w-6 object-contain dark:block" />
            <span className="font-mono text-sm font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
              talonr
            </span>
          </div>
          <span className="rounded border bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-zinc-500 uppercase dark:bg-zinc-800 dark:text-zinc-400">
            v1.0
          </span>
        </div>

        <div className="p-3">
          <Link
            to="/scrapes/new"
            onClick={onNavigate}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-accent px-3 py-2 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-90 active:scale-[0.99]"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            <span>Trigger Scrape</span>
          </Link>
        </div>

        <nav className="space-y-0.5 px-3 py-1">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={navLinkClass} onClick={onNavigate}>
              {item.icon}
              <span>{item.label}</span>
            </NavLink>
          ))}

          {user?.role === "admin" && (
            <div className="pt-5">
              <p className="px-3 pb-1.5 font-mono text-[10px] font-semibold tracking-wider text-zinc-400 uppercase dark:text-zinc-500">
                Admin Console
              </p>
              {ADMIN_NAV_ITEMS.map((item) => (
                <NavLink key={item.to} to={item.to} className={navLinkClass} onClick={onNavigate}>
                  {item.icon}
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </div>
          )}
        </nav>
      </div>

      <div className="border-t p-3 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-500">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[11px]">System: Active</span>
          <span className="h-2 w-2 rounded-full bg-emerald-500"></span>
        </div>
      </div>
    </div>
  );
}

/** Persistent on tablet/desktop (>=768px). Rendered separately from the mobile drawer below. */
export function Sidebar() {
  return (
    <aside className="hidden w-sidebar shrink-0 flex-col border-r bg-zinc-50/80 md:flex dark:bg-zinc-950 dark:border-zinc-800">
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
      <div className="fixed inset-0 bg-black/60 backdrop-blur-xs" onClick={onClose} />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative flex h-full w-64 flex-col border-r bg-zinc-50 outline-none dark:bg-zinc-950 dark:border-zinc-800"
      >
        <span id={titleId} className="sr-only">
          Navigation
        </span>
        <SidebarContent onNavigate={onClose} />
      </aside>
    </div>
  );
}
