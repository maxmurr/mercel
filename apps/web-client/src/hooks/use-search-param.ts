"use client";

import { useSearchParams } from "next/navigation";
import { useCallback } from "react";

export function useSearchParamState(
  name: string,
  fallback: string
): [string, (value: string) => void] {
  const value = useSearchParams().get(name) ?? fallback;

  const update = useCallback(
    (next: string) => {
      const url = new URL(window.location.href);
      url.searchParams.set(name, next);
      window.history.replaceState(null, "", url);
    },
    [name]
  );

  return [value, update];
}
