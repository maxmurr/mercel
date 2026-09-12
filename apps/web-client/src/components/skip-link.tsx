/** Put this on the `<main>` element of every page so the skip link has somewhere to land. */
export const mainContentId = "main-content";

/** Lets keyboard users jump past the sidebar and header; only visible while focused. */
export function SkipLink() {
  return (
    <a
      className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-popover focus:px-4 focus:py-2 focus:font-medium focus:text-popover-foreground focus:text-sm focus:outline-2 focus:outline-ring"
      href={`#${mainContentId}`}
    >
      Skip to main content
    </a>
  );
}
