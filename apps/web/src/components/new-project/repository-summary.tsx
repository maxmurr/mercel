import { GitBranchIcon } from "lucide-react";
import Image from "next/image";
import { CardDescription } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface RepositorySummaryProps {
  branch: string;
  className?: string;
  repository: string;
}

/** Shows the GitHub repository and branch selected for import. */
export function RepositorySummary({
  branch,
  className,
  repository,
}: RepositorySummaryProps) {
  return (
    <div
      className={cn("flex flex-col gap-1 rounded-lg bg-muted p-3", className)}
    >
      <CardDescription>Importing from GitHub</CardDescription>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
        <a
          className="flex min-w-0 items-center gap-2 rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          href={`https://github.com/${repository}`}
          rel="noopener noreferrer"
          target="_blank"
        >
          <Image
            alt=""
            className="shrink-0"
            height={16}
            src="/github.svg"
            width={16}
          />
          <span className="truncate">{repository}</span>
        </a>
        <span className="flex items-center gap-2 font-mono text-muted-foreground">
          <GitBranchIcon aria-hidden="true" className="size-4 shrink-0" />
          {branch}
        </span>
      </div>
    </div>
  );
}
