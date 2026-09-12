import { headers } from "next/headers";
import { Skeleton } from "@/components/ui/skeleton";
import { UserMenuActions } from "@/features/user/components/user-menu-actions";
import { getUserSession } from "@/features/user/user-queries";

export async function UserMenu() {
  const session = await getUserSession(await headers());
  const user = session?.user;
  return (
    <UserMenuActions
      user={
        user
          ? { email: user.email, image: user.image ?? null, name: user.name }
          : null
      }
    />
  );
}

export function UserMenuSkeleton() {
  return <Skeleton className="size-11 rounded-full" />;
}
