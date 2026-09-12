"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLinkIcon, UploadIcon } from "lucide-react";
import { type RefObject, useCallback, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import {
  getDeploymentPreviewUrl,
  publishWorkspace,
} from "@/features/workspace/workspace-deployment";
import { deploymentStatusOptions } from "@/features/workspace/workspace-query-options";

interface PublishButtonProps {
  /** The thread's last published deployment; reopens its site after a reload. */
  deploymentId?: string | undefined;
  threadId: string;
}

/** Publishes the thread's sandbox and follows the deployment until the site is live or it fails. */
export function PublishButton({ deploymentId, threadId }: PublishButtonProps) {
  // Guards a second click before the mutation's pending state has rendered.
  const inFlight: RefObject<boolean> = useRef(false);
  const failureShownFor = useRef<number>(undefined);
  const queryClient = useQueryClient();
  const publish = useMutation({
    mutationFn: () => publishWorkspace(threadId),
    onError: (error) => {
      toast.add({
        description: error.message,
        title: "Publish needs attention",
        type: "error",
      });
    },
    onSettled: () => {
      inFlight.current = false;
    },
    onSuccess: ({ id }) => {
      queryClient.setQueryData(deploymentStatusOptions(id).queryKey, "cloning");
    },
    retry: false,
  });
  const deployment =
    publish.data ??
    (deploymentId
      ? { id: deploymentId, previewUrl: getDeploymentPreviewUrl(deploymentId) }
      : undefined);
  const status = useQuery(deploymentStatusOptions(deployment?.id));
  const isLive = status.data === "completed";
  const hasFailed = status.data === "failed";
  const lookupFailed = status.isError && !isLive && !hasFailed;
  const isPublishing = Boolean(
    publish.isPending ||
      (deployment &&
        !isLive &&
        !hasFailed &&
        (!lookupFailed || status.isFetching))
  );
  let label = deployment ? "Republish" : "Publish";
  if (isPublishing) {
    label = "Publishing…";
  } else if (lookupFailed) {
    label = "Check status";
  }

  const handlePublish = useCallback(() => {
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    publish.mutate();
  }, [publish]);
  const { refetch } = status;
  const handleStatusCheck = useCallback(async () => {
    await refetch();
  }, [refetch]);

  const started = publish.data ? publish.submittedAt : undefined;
  useEffect(() => {
    if (!(started && hasFailed) || failureShownFor.current === started) {
      return;
    }
    failureShownFor.current = started;
    toast.add({
      description: "The build did not complete. Publish again to retry.",
      title: "Publish failed",
      type: "error",
    });
  }, [started, hasFailed]);

  return (
    <>
      {isLive && deployment ? (
        <Button
          className="h-11"
          nativeButton={false}
          render={
            <a
              href={deployment.previewUrl}
              rel="noopener noreferrer"
              target="_blank"
            />
          }
          variant="outline"
        >
          <ExternalLinkIcon data-icon="inline-start" />
          Open site
        </Button>
      ) : null}
      <Button
        aria-busy={isPublishing}
        className="h-11"
        disabled={isPublishing}
        onClick={lookupFailed ? handleStatusCheck : handlePublish}
        variant="default"
      >
        {isPublishing ? (
          <Spinner
            aria-hidden="true"
            className="motion-reduce:animate-none"
            data-icon="inline-start"
          />
        ) : (
          <UploadIcon data-icon="inline-start" />
        )}
        {label}
      </Button>
      {/* A live region of its own: announcing a control's own label re-reads the button. */}
      <p aria-live="polite" className="sr-only">
        {label}
      </p>
    </>
  );
}
