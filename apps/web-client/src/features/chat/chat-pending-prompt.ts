let pending: { prompt: string; threadId: string } | undefined;

/**
 * Holds the launcher's first message until its thread page mounts.
 *
 * Client navigation keeps this module alive, so the prompt travels without
 * widening the URL or the chat transport. A reload drops it on purpose: the
 * thread then opens empty instead of resending a message the user can't see.
 */
export function setPendingPrompt(threadId: string, prompt: string): void {
  pending = { prompt, threadId };
}

/** Returns the prompt queued for a thread and clears it so it is only sent once. */
export function takePendingPrompt(threadId: string): string {
  if (pending?.threadId !== threadId) {
    return "";
  }
  const { prompt } = pending;
  pending = undefined;
  return prompt;
}
