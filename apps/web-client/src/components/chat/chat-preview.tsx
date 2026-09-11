"use client";

import { ExternalLinkIcon, MonitorIcon, RotateCwIcon } from "lucide-react";
import { useCallback, useState } from "react";
import {
  WebPreview,
  WebPreviewBody,
  WebPreviewConsole,
  WebPreviewNavigation,
  WebPreviewNavigationButton,
  WebPreviewUrl,
} from "@/components/ai-elements/web-preview";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { cn } from "@/lib/utils";

interface ChatPreviewProps {
  className?: string;
  title: string;
  url?: string;
}

/** Shows a script-enabled chat preview, or an empty state until the caller supplies a separate-origin URL. */
export function ChatPreview({ className, title, url }: ChatPreviewProps) {
  const [previewRevision, setPreviewRevision] = useState(0);

  const handlePreviewReload = useCallback(() => {
    setPreviewRevision((revision) => revision + 1);
  }, []);

  return (
    <WebPreview className={cn("rounded-none border-0", className)}>
      <WebPreviewNavigation>
        <WebPreviewNavigationButton
          className="size-11"
          disabled={!url}
          onClick={handlePreviewReload}
          tooltip="Reload preview"
        >
          <RotateCwIcon />
        </WebPreviewNavigationButton>
        <WebPreviewUrl value={url ?? "/"} />
        <WebPreviewNavigationButton
          className="size-11"
          disabled={!url}
          nativeButton={false}
          render={<a href={url} rel="noopener noreferrer" target="_blank" />}
          tooltip="Open preview in new tab"
        >
          <ExternalLinkIcon />
        </WebPreviewNavigationButton>
      </WebPreviewNavigation>
      {url ? (
        <WebPreviewBody
          key={previewRevision}
          sandbox="allow-scripts allow-same-origin allow-forms"
          src={url}
          title={title}
        />
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <MonitorIcon />
            </EmptyMedia>
            <EmptyTitle>No preview yet</EmptyTitle>
            <EmptyDescription>
              Ask the agent to build something and it will show up here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      <WebPreviewConsole />
    </WebPreview>
  );
}
