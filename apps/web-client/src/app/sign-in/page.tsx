import type { Metadata } from "next";
import { mainContentId } from "@/components/skip-link";
import { GitHubSignInButton } from "@/features/user/components/github-sign-in-button";

export const metadata: Metadata = {
  description: "Sign in to Mercel with GitHub",
  title: "Sign in",
};

/** Shows a single-action sign-in screen centered in the selected app theme. */
export default function SignInPage() {
  return (
    <main
      className="inset-safe isolate flex min-h-svh items-center justify-center bg-background p-6 text-foreground antialiased"
      id={mainContentId}
      tabIndex={-1}
    >
      <div className="flex w-full max-w-xs flex-col gap-8">
        <div className="flex flex-col gap-2 text-center">
          <h1 className="text-balance font-semibold text-2xl tracking-tight">
            Sign in to Mercel
          </h1>
        </div>
        <GitHubSignInButton />
      </div>
    </main>
  );
}
