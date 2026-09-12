import { NewProjectForm } from "@/components/new-project/new-project-form";
import { mainContentId } from "@/components/skip-link";

/** Shows a flat mobile form and a centered desktop card in the selected app theme. */
export default function HomePage() {
  return (
    <main
      className="inset-safe isolate flex min-h-svh items-start justify-center bg-background p-6 text-foreground antialiased sm:items-center sm:px-8 sm:py-4"
      id={mainContentId}
      tabIndex={-1}
    >
      <NewProjectForm className="w-full max-w-2xl" />
    </main>
  );
}
