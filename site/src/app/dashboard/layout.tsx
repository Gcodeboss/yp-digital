import DashGuide from "@/components/dash-guide";
import ThemeToggle from "@/components/theme-toggle";
import { THEME_ROOT_ID } from "@/lib/theme";

/**
 * The themed root for every dashboard route.
 *
 * This lives at the route layout rather than on <html> so the console palette is
 * scoped to the internal tool — the public marketing site never carries the
 * attribute and therefore cannot regress. It also cannot live on `Shell`: the
 * timeline screen builds its own frame and never renders Shell, so a theme
 * anchored there would silently skip the one screen the system was designed for.
 *
 * Design tokens are CSS custom properties, so everything below this node
 * re-resolves when the attribute changes. See globals.css and DESIGN-CONSOLE.md.
 *
 * Rendered server-side at the default, so there is no flash of the wrong theme;
 * ThemeToggle rewrites this node's attribute when a stored preference differs.
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div id={THEME_ROOT_ID} data-theme="console" className="min-h-dvh bg-ground text-ink">
      {children}
      {/* Route-level so it reaches every screen, including the ones that build
          their own chrome instead of rendering Shell. Bottom-RIGHT specifically:
          bottom-left is where the Next dev-tools badge sits and it covered the
          control, and the top edge belongs to each screen's own actions. */}
      <div className="pointer-events-none fixed right-3 bottom-3 z-50 flex items-center gap-2">
        <DashGuide />
        <div className="pointer-events-auto opacity-60 transition-opacity hover:opacity-100">
          <ThemeToggle />
        </div>
      </div>
    </div>
  );
}
