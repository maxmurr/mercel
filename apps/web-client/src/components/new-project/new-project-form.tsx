"use client";

import { skipToken, useMutation, useQuery } from "@tanstack/react-query";
import {
  type RefObject,
  type SubmitEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
} from "react";
import { ProjectSettings } from "@/components/new-project/project-settings";
import { RepositoryField } from "@/components/new-project/repository-field";
import { SitePreview } from "@/components/new-project/site-preview";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import {
  fetchDeploymentStatus,
  shouldRetryDeploymentStatus,
  startDeployment,
} from "@/lib/deployment";
import { cn } from "@/lib/utils";

const repositorySuffixPattern = /(?:\.git)?\/?$/;
const DEPLOYMENT_POLL_INTERVAL_MS = 2000;

/** Deploys the submitted repository and observes its persisted status until completion. */
export function NewProjectForm({ className }: { className?: string }) {
  const formId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const submissionLocked: RefObject<boolean> = useRef(false);
  const deployment = useMutation({ mutationFn: startDeployment, retry: false });
  const { mutate, variables: submittedRepoUrl = "" } = deployment;
  const repository = submittedRepoUrl
    .replace("https://github.com/", "")
    .replace(repositorySuffixPattern, "");
  const deploymentId = deployment.data?.id;
  const deploymentStatus = useQuery({
    enabled: Boolean(deploymentId),
    queryFn: deploymentId
      ? ({ signal }) => fetchDeploymentStatus(deploymentId, signal)
      : skipToken,
    queryKey: ["deployment", deploymentId],
    refetchInterval: (query) =>
      query.state.status === "error" ||
      query.state.data === "completed" ||
      query.state.data === "failed"
        ? false
        : DEPLOYMENT_POLL_INTERVAL_MS,
    refetchIntervalInBackground: true,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    retry: shouldRetryDeploymentStatus,
    staleTime: 0,
  });
  const showCongratulations = deploymentStatus.data === "completed";
  const deploymentFailed = deploymentStatus.data === "failed";
  const statusLookupFailed =
    deploymentStatus.isError && !showCongratulations && !deploymentFailed;
  const isDeploying = Boolean(
    deployment.isPending ||
      (deploymentId &&
        !showCongratulations &&
        !deploymentFailed &&
        (!statusLookupFailed || deploymentStatus.isFetching))
  );
  const repositoryLocked = isDeploying || statusLookupFailed;
  let deploymentError =
    deployment.error?.message ??
    (deploymentFailed ? "Deployment failed. You can deploy again." : "");
  if (statusLookupFailed) {
    deploymentError =
      "Could not check deployment status. Deployment may still be running. Check Status to try again.";
  }
  let buttonLabel = "Deploy";
  if (isDeploying) {
    buttonLabel = "Deploying…";
  } else if (statusLookupFailed) {
    buttonLabel = "Check Status";
  }

  const handleDeploymentSubmit = useCallback(
    (event: SubmitEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (
        submissionLocked.current ||
        isDeploying ||
        !event.currentTarget.reportValidity()
      ) {
        return;
      }
      const repoUrl = new FormData(event.currentTarget).get("repoUrl");
      if (typeof repoUrl !== "string") {
        return;
      }
      submissionLocked.current = true;
      mutate(repoUrl);
    },
    [isDeploying, mutate]
  );
  const { refetch } = deploymentStatus;
  const handleStatusCheck = useCallback(async () => {
    await refetch();
  }, [refetch]);

  useEffect(() => {
    submissionLocked.current =
      isDeploying || (Boolean(deploymentId) && !deploymentFailed);
  }, [isDeploying, deploymentId, deploymentFailed]);

  useEffect(() => {
    if (showCongratulations) {
      headingRef.current?.focus();
    }
  }, [showCongratulations]);

  return (
    <div className={cn("flex flex-col gap-6", className)}>
      <Card className="gap-6 max-sm:contents sm:py-8">
        <CardHeader className="gap-4 px-0 sm:px-8">
          <CardTitle>
            <h1
              className="scroll-mt-4 text-balance rounded-lg font-semibold text-2xl tracking-tight focus:outline-2 focus:outline-ring focus:outline-offset-4"
              ref={headingRef}
              tabIndex={-1}
            >
              {showCongratulations ? "Congratulations!" : "New Project"}
            </h1>
          </CardTitle>
          <CardDescription>
            {showCongratulations
              ? "Your deployment is ready. Preview it below or open the site."
              : "Deploy your GitHub repository using the settings below."}
          </CardDescription>
          <CardAction>
            <ThemeSwitcher />
          </CardAction>
        </CardHeader>
        <CardContent className="px-0 sm:px-8">
          {showCongratulations && deployment.data ? (
            <SitePreview href={deployment.data.previewUrl} title={repository} />
          ) : (
            <form id={formId} onSubmit={handleDeploymentSubmit}>
              <FieldGroup>
                <RepositoryField disabled={repositoryLocked} />
                <ProjectSettings />
              </FieldGroup>
            </form>
          )}
        </CardContent>
        {!showCongratulations && (
          <CardFooter className="flex-col items-stretch gap-3 p-6 max-sm:contents sm:px-8 sm:pb-8">
            {Boolean(deploymentError) && (
              <Alert variant="destructive">
                <AlertTitle>Deployment needs attention</AlertTitle>
                <AlertDescription>{deploymentError}</AlertDescription>
              </Alert>
            )}
            <Button
              aria-busy={isDeploying}
              disabled={isDeploying}
              form={formId}
              onClick={statusLookupFailed ? handleStatusCheck : undefined}
              size="lg"
              type={statusLookupFailed ? "button" : "submit"}
            >
              {isDeploying && (
                <Spinner
                  aria-hidden="true"
                  className="motion-reduce:animate-none"
                  data-icon="inline-start"
                />
              )}
              {buttonLabel}
            </Button>
            {/* A live region of its own: announcing a control's own label re-reads the button. */}
            <p aria-live="polite" className="sr-only">
              {buttonLabel}
            </p>
          </CardFooter>
        )}
      </Card>
    </div>
  );
}
