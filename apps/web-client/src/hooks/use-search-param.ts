"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";

/**
 * Keeps one piece of view state in the URL so a reload or a shared link reopens it.
 *
 * The URL seeds the initial value; after that React state drives rendering and the
 * URL follows. Writes go through the native history API, which Next.js understands,
 * and replace the entry so the back button still leaves the page instead of stepping
 * through every toggle.
 */
export function useSearchParamState(
  name: string,
  fallback: string
): [string, (value: string) => void] {
  const initial = useSearchParams().get(name);
  const [value, setValue] = useState(initial ?? fallback);

  const update = useCallback(
    (next: string) => {
      setValue(next);
      const params = new URLSearchParams(window.location.search);
      params.set(name, next);
      window.history.replaceState(null, "", `?${params.toString()}`);
    },
    [name]
  );

  return [value, update];
}
