"use client";

import { LogOutIcon, SunMoonIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { ThemeMenuItems } from "@/components/theme-switcher";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { authClient } from "@/lib/auth-client";

const wordSeparator = /\s+/;

/** Builds the avatar monogram, falling back to the email when the account has no name. */
function getMonogram(name: string, email: string): string {
  const letters = name
    .trim()
    .split(wordSeparator)
    .slice(0, 2)
    .map((word) => word.charAt(0))
    .join("");
  return (letters || email.charAt(0)).toUpperCase();
}

/** Shows the account photo, falling back to a monogram while the photo is missing or loading. */
function AccountAvatar({
  image,
  monogram,
}: {
  image: string | undefined;
  monogram: string;
}) {
  return (
    <Avatar>
      <AvatarImage alt="" src={image} />
      <AvatarFallback>{monogram}</AvatarFallback>
    </Avatar>
  );
}

/** Shows the signed-in account and its actions; renders nothing while signed out. */
export function UserMenu() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();

  const signOut = useCallback(async () => {
    const { error } = await authClient.signOut();
    if (error) {
      toast.add({ title: "Could not sign out. Try again.", type: "error" });
      return;
    }
    router.push("/sign-in");
  }, [router]);

  if (isPending) {
    return <Skeleton className="size-11 rounded-full" />;
  }

  const user = session?.user;
  if (!user) {
    return null;
  }

  const image = user.image ?? undefined;
  const monogram = getMonogram(user.name, user.email);
  const displayName = user.name.trim() || user.email;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Account menu for ${displayName}`}
        render={
          <Button
            className="size-11 rounded-full"
            size="icon"
            variant="ghost"
          />
        }
      >
        <AccountAvatar image={image} monogram={monogram} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <div className="flex items-center gap-3 p-1.5">
          <AccountAvatar image={image} monogram={monogram} />
          <div className="min-w-0">
            <p className="truncate font-medium text-sm">{displayName}</p>
            {displayName === user.email ? null : (
              <p className="truncate text-muted-foreground text-xs">
                {user.email}
              </p>
            )}
          </div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="min-h-11">
            <SunMoonIcon aria-hidden="true" />
            Theme
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-40">
            <ThemeMenuItems />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem className="min-h-11" onClick={signOut}>
          <LogOutIcon aria-hidden="true" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
