"use client";

import { ExternalLinkIcon, RotateCwIcon } from "lucide-react";
import { useCallback, useState } from "react";
import {
  WebPreview,
  WebPreviewBody,
  WebPreviewNavigation,
  WebPreviewNavigationButton,
  WebPreviewUrl,
} from "@/components/ai-elements/web-preview";
import { cn } from "@/lib/utils";

interface ChatPreviewProps {
  className?: string;
  title: string;
  url: string;
}

/** Shows a script-enabled chat preview; the caller must supply a separate-origin URL. */
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
          onClick={handlePreviewReload}
          tooltip="Reload preview"
        >
          <RotateCwIcon />
        </WebPreviewNavigationButton>
        <WebPreviewUrl value={url} />
        <WebPreviewNavigationButton
          className="size-11"
          nativeButton={false}
          render={<a href={url} rel="noopener noreferrer" target="_blank" />}
          tooltip="Open preview in new tab"
        >
          <ExternalLinkIcon />
        </WebPreviewNavigationButton>
      </WebPreviewNavigation>
      <WebPreviewBody
        key={previewRevision}
        sandbox="allow-scripts allow-same-origin allow-forms"
        src={url}
        title={title}
      />
      <p className="px-4 py-3 text-muted-foreground text-xs">
        Static example. Chat messages do not change this preview.
      </p>
    </WebPreview>
  );
}
