/**
 * Archive Space routes use the contextual page-tree Dock by default. The global
 * Space Dock remains available as a temporary expansion and still obeys the
 * persisted collapse preference.
 */
export function shouldShowArchiveGlobalDock(
  pathname: string,
  dockCollapsed: boolean,
  spaceGlobalDockOpen: boolean,
): boolean {
  if (dockCollapsed) return false;
  if (!pathname.startsWith("/s/")) return true;
  return spaceGlobalDockOpen;
}

export type ArchiveSidebarPresentation = "expanded" | "compact";

export function getArchiveSidebarPresentation(
  pathname: string,
  dockCollapsed: boolean,
  spaceGlobalDockOpen: boolean,
): ArchiveSidebarPresentation {
  return shouldShowArchiveGlobalDock(pathname, dockCollapsed, spaceGlobalDockOpen)
    ? "expanded"
    : "compact";
}
