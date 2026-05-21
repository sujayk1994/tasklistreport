import { ReactNode, useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  CheckSquare,
  Clock,
  Settings,
  LogOut,
  Shield,
  PanelLeftClose,
  PanelLeftOpen,
  Minus,
  Plus,
} from "lucide-react";
import { useClerk } from "@clerk/react";
import { useIsAdmin } from "@/hooks/use-admin";
import { Button } from "@/components/ui/button";

const SIDEBAR_KEY = "task-manager-sidebar-collapsed";
const ZOOM_KEY = "task-manager-zoom";
const ZOOM_LEVELS = [50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200];

function readInitialZoom(): number {
  if (typeof window === "undefined") return 100;
  try {
    const raw = window.localStorage.getItem(ZOOM_KEY);
    const n = raw ? parseInt(raw, 10) : 100;
    return ZOOM_LEVELS.includes(n) ? n : 100;
  } catch {
    return 100;
  }
}

export default function Layout({
  children,
  bleed = false,
}: {
  children: ReactNode;
  bleed?: boolean;
}) {
  const [location] = useLocation();
  const { signOut } = useClerk();
  const isAdmin = useIsAdmin();

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(SIDEBAR_KEY) === "1";
    } catch {
      return false;
    }
  });

  const [zoom, setZoom] = useState<number>(readInitialZoom);

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_KEY, collapsed ? "1" : "0");
    } catch {}
  }, [collapsed]);

  // Listen for the global keyboard-shortcut event dispatched from app.tsx
  // (Ctrl/Cmd+B) so the sidebar can toggle even when the focus is on the
  // board canvas. Self-contained — no prop drilling required.
  useEffect(() => {
    const handler = () => setCollapsed((prev) => !prev);
    window.addEventListener("task-manager:toggle-sidebar", handler);
    return () =>
      window.removeEventListener("task-manager:toggle-sidebar", handler);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(ZOOM_KEY, String(zoom));
    } catch {}
    // Scale by adjusting the root font-size. Tailwind's spacing/typography
    // scale is rem-based, so this shrinks/enlarges UI elements (text,
    // padding, gaps, rem-based widths) without changing the page size —
    // the layout still fills the full viewport.
    const root = document.documentElement;
    if (zoom === 100) {
      root.style.fontSize = "";
    } else {
      root.style.fontSize = `${(16 * zoom) / 100}px`;
    }
    return () => {
      root.style.fontSize = "";
    };
  }, [zoom]);

  const zoomOut = () => {
    const idx = ZOOM_LEVELS.indexOf(zoom);
    const next = idx > 0 ? ZOOM_LEVELS[idx - 1] : ZOOM_LEVELS[0];
    setZoom(next);
  };
  const zoomIn = () => {
    const idx = ZOOM_LEVELS.indexOf(zoom);
    const next =
      idx >= 0 && idx < ZOOM_LEVELS.length - 1
        ? ZOOM_LEVELS[idx + 1]
        : ZOOM_LEVELS[ZOOM_LEVELS.length - 1];
    setZoom(next);
  };
  const resetZoom = () => setZoom(100);

  const navItems = [
    { href: "/app", label: "Today", icon: CheckSquare },
    { href: "/history", label: "History", icon: Clock },
    { href: "/settings", label: "Settings", icon: Settings },
  ];

  return (
    <div className="min-h-screen bg-background flex flex-col md:flex-row relative">
      {!collapsed && (
        <nav className="w-full md:w-64 border-b md:border-b-0 md:border-r border-border bg-card/50 p-6 flex flex-col">
          <div className="flex items-center justify-between gap-3 mb-10">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 rounded-md bg-primary text-primary-foreground flex items-center justify-center shrink-0">
                <CheckSquare size={18} />
              </div>
              <span className="font-serif font-semibold text-lg tracking-tight truncate">
                Daily Tasks
              </span>
            </div>
            <button
              type="button"
              onClick={() => setCollapsed(true)}
              className="text-muted-foreground hover:text-foreground p-1 rounded-md hover:bg-muted transition-colors"
              aria-label="Hide sidebar"
              title="Hide sidebar"
            >
              <PanelLeftClose size={18} />
            </button>
          </div>

          <div className="flex-1 flex flex-col gap-2">
            {navItems.map((item) => {
              const isActive =
                location === item.href ||
                (item.href !== "/app" && location.startsWith(item.href));
              const Icon = item.icon;

              return (
                <Link key={item.href} href={item.href} className="block">
                  <Button
                    variant={isActive ? "secondary" : "ghost"}
                    className={`w-full justify-start gap-3 h-10 ${
                      isActive
                        ? "font-medium"
                        : "text-muted-foreground font-normal hover:text-foreground"
                    }`}
                  >
                    <Icon size={18} />
                    {item.label}
                  </Button>
                </Link>
              );
            })}

            {isAdmin && (
              <Link href="/admin" className="block mt-2">
                <Button
                  variant={
                    location.startsWith("/admin") ? "secondary" : "ghost"
                  }
                  className={`w-full justify-start gap-3 h-10 ${
                    location.startsWith("/admin")
                      ? "font-medium"
                      : "text-muted-foreground font-normal hover:text-foreground"
                  }`}
                >
                  <Shield size={18} />
                  Admin
                </Button>
              </Link>
            )}
          </div>

          <div className="mt-auto pt-6 space-y-3">
            <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-background/60 px-2 py-1.5">
              <button
                type="button"
                onClick={zoomOut}
                disabled={zoom === ZOOM_LEVELS[0]}
                className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label="Zoom out"
                title="Zoom out"
              >
                <Minus size={14} />
              </button>
              <button
                type="button"
                onClick={resetZoom}
                className="text-xs font-medium tabular-nums text-foreground hover:text-primary px-2 py-0.5 rounded"
                title="Reset to 100%"
              >
                {zoom}%
              </button>
              <button
                type="button"
                onClick={zoomIn}
                disabled={zoom === ZOOM_LEVELS[ZOOM_LEVELS.length - 1]}
                className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label="Zoom in"
                title="Zoom in"
              >
                <Plus size={14} />
              </button>
            </div>
            <Button
              variant="ghost"
              className="w-full justify-start gap-3 text-muted-foreground hover:text-foreground"
              onClick={() => signOut()}
            >
              <LogOut size={18} />
              Sign out
            </Button>
          </div>
        </nav>
      )}

      {collapsed && (
        <div className="md:w-10 w-full md:border-r md:border-b-0 border-b border-border bg-card/40 flex md:flex-col items-center md:items-stretch md:justify-start justify-end px-2 md:px-0 md:py-3 py-2 shrink-0">
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            className="flex items-center justify-center w-8 h-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="Show sidebar"
            title="Show sidebar"
          >
            <PanelLeftOpen size={16} />
          </button>
        </div>
      )}

      <main
        className={
          bleed
            ? "flex-1 w-full overflow-hidden flex flex-col min-h-0"
            : "flex-1 w-full p-6 md:p-12 overflow-y-auto"
        }
      >
        {children}
      </main>
    </div>
  );
}
