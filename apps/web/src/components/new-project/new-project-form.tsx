"use client";

import {
  type SubmitEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { ProjectSettings } from "@/components/new-project/project-settings";
import { RepositorySummary } from "@/components/new-project/repository-summary";
import { SitePreview } from "@/components/new-project/site-preview";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** Shows project setup and a demo completion state without starting a deployment. */
export function NewProjectForm({ className }: { className?: string }) {
  const formId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [showCongratulations, setShowCongratulations] = useState(false);
  const handleDeploymentSubmit = useCallback(
    (event: SubmitEvent<HTMLFormElement>) => {
      event.preventDefault();
      setShowCongratulations(true);
    },
    []
  );

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
              className="text-balance font-semibold text-2xl tracking-tight outline-none"
              ref={headingRef}
              tabIndex={-1}
            >
              {showCongratulations ? "Congratulations!" : "New Project"}
            </h1>
          </CardTitle>
          {showCongratulations ? (
            <CardDescription>
              Click the preview to visit vercel.com.
            </CardDescription>
          ) : (
            <RepositorySummary
              branch="main"
              repository="maxmurr/vite-react-app"
            />
          )}
        </CardHeader>
        <CardContent className="px-0 sm:px-8">
          {showCongratulations ? (
            <SitePreview
              href="https://vercel.com"
              imageSrc="/vercel-preview.jpg"
              title="vercel.com"
            />
          ) : (
            <form id={formId} onSubmit={handleDeploymentSubmit}>
              <ProjectSettings />
            </form>
          )}
        </CardContent>
        {!showCongratulations && (
          <CardFooter className="flex-col items-stretch gap-3 p-6 max-sm:contents sm:px-8 sm:pb-8">
            <Button form={formId} size="lg" type="submit">
              Deploy
            </Button>
          </CardFooter>
        )}
      </Card>
    </div>
  );
}
