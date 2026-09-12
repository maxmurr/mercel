"use client";

import { catchError, type ErrorInfo } from "next/error";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

function SectionErrorFallback(
  { title }: { title: string },
  { retry }: ErrorInfo
) {
  return (
    <Alert className="m-2 w-auto" variant="destructive">
      <AlertDescription>{title}</AlertDescription>
      <Button
        className="min-h-11 justify-self-start"
        onClick={retry}
        variant="outline"
      >
        Retry
      </Button>
    </Alert>
  );
}

export const SectionErrorBoundary = catchError(SectionErrorFallback);
