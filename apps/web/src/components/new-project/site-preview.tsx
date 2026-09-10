import { ArrowUpRightIcon } from "lucide-react";
import Image from "next/image";
import { cn } from "@/lib/utils";

interface SitePreviewProps {
  className?: string;
  href: string;
  imageSrc: string;
  title: string;
}

/** Opens the previewed website in a new tab without leaving the project page. */
export function SitePreview({
  className,
  href,
  imageSrc,
  title,
}: SitePreviewProps) {
  return (
    <a
      aria-label={`Visit ${title} in a new tab`}
      className={cn(
        "group/site-preview flex flex-col overflow-hidden rounded-lg border outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
        className
      )}
      href={href}
      rel="noopener noreferrer"
      target="_blank"
    >
      <Image
        alt={`${title} website preview`}
        className="h-auto w-full"
        height={900}
        sizes="(min-width: 640px) 608px, calc(100vw - 48px)"
        src={imageSrc}
        width={1440}
      />
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <span className="truncate">{title}</span>
        <ArrowUpRightIcon
          aria-hidden="true"
          className="size-4 shrink-0 transition-transform duration-200 ease-out motion-safe:group-hover/site-preview:translate-x-0.5 motion-safe:group-hover/site-preview:-translate-y-0.5 motion-reduce:transition-none"
        />
      </div>
    </a>
  );
}
