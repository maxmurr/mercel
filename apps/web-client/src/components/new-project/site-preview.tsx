import { ArrowUpRightIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface SitePreviewProps {
  className?: string;
  href: string;
  title: string;
}

/** Shows a dark-mode site preview with one new-tab link covering the entire card. */
export function SitePreview({ className, href, title }: SitePreviewProps) {
  return (
    <div
      className={cn(
        // The link covers the card, so the card carries its ring — keyboard focus only.
        "relative flex flex-col overflow-hidden rounded-lg border has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
        className
      )}
    >
      <iframe
        aria-hidden="true"
        className="scheme-only-dark pointer-events-none aspect-video w-full border-0"
        loading="lazy"
        referrerPolicy="no-referrer"
        sandbox="allow-scripts allow-same-origin"
        scrolling="no"
        src={href}
        tabIndex={-1}
        title={`${title} deployment preview`}
      />
      <a
        aria-label={`Open site: ${title} in a new tab`}
        className="group/site-preview flex min-h-11 items-center justify-between gap-3 border-t px-4 py-3 outline-none after:absolute after:inset-0"
        href={href}
        rel="noopener noreferrer"
        target="_blank"
      >
        <span className="truncate">Open site</span>
        <ArrowUpRightIcon
          aria-hidden="true"
          className="size-4 shrink-0 transition-transform duration-200 ease-out motion-safe:group-hover/site-preview:translate-x-0.5 motion-safe:group-hover/site-preview:-translate-y-0.5 motion-reduce:transition-none"
        />
      </a>
    </div>
  );
}
