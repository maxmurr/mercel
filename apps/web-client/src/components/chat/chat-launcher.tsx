"use client";

import { ArrowUpIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ChangeEvent, type FormEvent, useCallback, useState } from "react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { useSubmitOnEnter } from "@/hooks/use-submit-on-enter";
import { setPendingPrompt } from "@/lib/pending-prompt";
import { cn } from "@/lib/utils";

/** Opens a new conversation from a first prompt; the thread page sends it once it connects. */
export function ChatLauncher({ className }: { className?: string }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const submitOnEnter = useSubmitOnEnter();

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const prompt = value.trim();
      if (!prompt) {
        return;
      }
      const threadId = crypto.randomUUID();
      setPendingPrompt(threadId, prompt);
      router.push(`/chat/${threadId}`);
    },
    [router, value]
  );

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      setValue(event.currentTarget.value);
    },
    []
  );

  return (
    <div
      className={cn(
        "flex w-full max-w-2xl flex-col items-center gap-6 sm:gap-8",
        className
      )}
    >
      <h1 className="max-w-[35ch] text-balance text-center font-semibold text-3xl tracking-tight sm:text-4xl">
        What do you want to create?
      </h1>
      <form
        aria-label="Start a conversation"
        className="w-full"
        onSubmit={handleSubmit}
      >
        <InputGroup>
          <InputGroupTextarea
            aria-label="Describe what you want to create"
            autoComplete="off"
            className="field-sizing-content scrollbar-subtle max-h-64 min-h-28"
            name="prompt"
            onChange={handleChange}
            placeholder="Describe the app you want to build…"
            value={value}
            {...submitOnEnter}
          />
          <InputGroupAddon align="block-end" className="justify-end">
            <InputGroupButton
              aria-label="Start Building"
              className="size-11"
              disabled={!value.trim()}
              size="icon-sm"
              type="submit"
              variant="default"
            >
              <ArrowUpIcon />
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </form>
    </div>
  );
}
