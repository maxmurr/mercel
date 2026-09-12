import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Geist } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { QueryProvider } from "@/components/query-provider";
import { SkipLink } from "@/components/skip-link";
import { Toaster } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  description: "Describe the app you want and watch an agent build it.",
  title: "Mercel",
};

// The two colors mirror --background in globals.css so the browser chrome matches the page.
export const viewport: Viewport = {
  themeColor: [
    { color: "#fbfbfb", media: "(prefers-color-scheme: light)" },
    { color: "#000000", media: "(prefers-color-scheme: dark)" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      className={cn("font-sans", geist.variable)}
      lang="en"
      suppressHydrationWarning
    >
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          disableTransitionOnChange
          enableSystem
        >
          <QueryProvider>
            <TooltipProvider>
              <SkipLink />
              {children}
            </TooltipProvider>
            <Toaster />
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
