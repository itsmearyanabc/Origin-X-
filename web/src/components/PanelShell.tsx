import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import { LogOut, Menu, Moon, Sun, X, type LucideIcon } from "lucide-react";
import { Logo } from "./ui";
import { useAuth } from "@/lib/auth";
import { storage } from "@/lib/storage";
import { cn } from "@/lib/format";

export type NavItem = { to: string; label: string; icon: LucideIcon; end?: boolean; badge?: number | null; hidden?: boolean };
export type NavGroup = { label: string; items: NavItem[] };

/** Panels support dark mode; the choice is remembered per browser. */
function useTheme() {
  const [dark, setDark] = useState(() => {
    const stored = storage.get("originx.theme");
    return stored ? stored === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
  });
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    storage.set("originx.theme", dark ? "dark" : "light");
    return () => document.documentElement.classList.remove("dark");
  }, [dark]);
  return [dark, () => setDark((d) => !d)] as const;
}

function Sidebar({ groups, footer, onNavigate }: { groups: NavGroup[]; footer?: ReactNode; onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4" aria-label="Panel">
        {groups.map((g) => {
          const items = g.items.filter((i) => !i.hidden);
          if (!items.length) return null;
          return (
            <div key={g.label}>
              <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-muted/80">{g.label}</p>
              <ul className="space-y-0.5">
                {items.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.end}
                      onClick={onNavigate}
                      className={({ isActive }) =>
                        cn(
                          "group relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors",
                          isActive ? "text-brand-700 dark:text-brand-300" : "text-muted hover:bg-surface-2 hover:text-fg",
                        )
                      }
                    >
                      {({ isActive }) => (
                        <>
                          {isActive && <motion.span layoutId="panel-nav" className="absolute inset-0 rounded-xl bg-brand-50 ring-1 ring-brand-100 dark:bg-brand-500/10 dark:ring-brand-500/20" transition={{ type: "spring", damping: 30, stiffness: 380 }} />}
                          <item.icon className={cn("relative h-[18px] w-[18px]", isActive ? "text-brand-600 dark:text-brand-400" : "text-muted group-hover:text-fg")} />
                          <span className="relative flex-1">{item.label}</span>
                          {item.badge ? <span className="relative rounded-full bg-brand-500 px-1.5 py-0.5 text-[10px] font-bold text-white">{item.badge}</span> : null}
                        </>
                      )}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </nav>
      {footer && <div className="border-t border-line p-3">{footer}</div>}
    </div>
  );
}

function UserMenu() {
  const { me, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const initials = (me?.fullName ?? "?")
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 rounded-xl p-1 pr-2 hover:bg-surface-2" aria-haspopup="menu" aria-expanded={open}>
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-brand-400 to-brand-600 text-xs font-bold text-white">{initials}</span>
        <span className="hidden max-w-[10rem] truncate text-sm font-medium text-fg md:block">{me?.fullName}</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div role="menu" initial={{ opacity: 0, y: -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.98 }} transition={{ duration: 0.15 }} className="absolute right-0 top-full z-30 mt-2 w-64 rounded-2xl border border-line bg-surface p-2 shadow-lift">
            <div className="px-3 py-2">
              <p className="truncate text-sm font-semibold text-fg">{me?.fullName}</p>
              <p className="truncate text-xs text-muted">{me?.email}</p>
            </div>
            <div className="my-1 h-px bg-line" />
            <button role="menuitem" onClick={signOut} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-fg hover:bg-surface-2">
              <LogOut className="h-4 w-4 text-muted" /> Sign out
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function PanelShell({ groups, title, topLeft, banner, sidebarFooter, homeTo }: { groups: NavGroup[]; title: string; topLeft?: ReactNode; banner?: ReactNode; sidebarFooter?: ReactNode; homeTo: string }) {
  const [dark, toggle] = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setMobileOpen(false), [location.pathname]);

  return (
    <div className="min-h-screen bg-bg text-fg">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-line bg-surface lg:flex">
        <div className="flex h-16 items-center gap-2 border-b border-line px-5">
          <Logo to={homeTo} />
          <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted">{title}</span>
        </div>
        <Sidebar groups={groups} footer={sidebarFooter} />
      </aside>

      {/* Mobile drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div className="fixed inset-0 z-40 bg-ink-950/50 lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setMobileOpen(false)} />
            <motion.aside className="fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-surface shadow-lift lg:hidden" initial={{ x: "-100%" }} animate={{ x: 0 }} exit={{ x: "-100%" }} transition={{ type: "spring", damping: 30, stiffness: 300 }}>
              <div className="flex h-16 items-center justify-between border-b border-line px-5">
                <Logo to={homeTo} />
                <button onClick={() => setMobileOpen(false)} className="rounded-lg p-2 text-muted" aria-label="Close menu">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <Sidebar groups={groups} footer={sidebarFooter} onNavigate={() => setMobileOpen(false)} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-surface/85 px-4 backdrop-blur-xl sm:px-6">
          <button onClick={() => setMobileOpen(true)} className="rounded-lg p-2 text-muted lg:hidden" aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">{topLeft}</div>
          <button onClick={toggle} className="rounded-xl p-2 text-muted transition hover:bg-surface-2 hover:text-fg" aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}>
            <AnimatePresence mode="wait" initial={false}>
              <motion.span key={dark ? "sun" : "moon"} initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }} transition={{ duration: 0.2 }} className="block">
                {dark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
              </motion.span>
            </AnimatePresence>
          </button>
          <UserMenu />
        </header>
        {banner}
        <main className="px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <motion.div key={location.pathname} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }} className="mx-auto max-w-7xl">
            <Outlet />
          </motion.div>
        </main>
      </div>
    </div>
  );
}
