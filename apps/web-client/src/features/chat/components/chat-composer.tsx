"use client";

import { useChatId, useChatStore } from "@ai-sdk-tools/store";
import { ArrowUpIcon, SquareIcon } from "lucide-react";
import {
  type ChangeEvent,
  type FormEvent,
  useCallback,
  useId,
  useRef,
  useState,
} from "react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { stopThreadRun } from "@/features/chat/chat-query-options";
import { useSubmitOnEnter } from "@/features/chat/hooks/use-submit-on-enter";
import { cn } from "@/lib/utils";

interface ChatComposerProps {
  className?: string;
  describedBy?: string;
}

/** Sends trimmed chat text on Enter while preserving Shift+Enter and IME confirmation. */
export function ChatComposer({ className, describedBy }: ChatComposerProps) {
  const hintId = useId();
  const threadId = useChatId();
  const [value, setValue] = useState("");
  const sendMessage = useChatStore((state) => state.sendMessage);
  const stop = useChatStore((state) => state.stop);
  const isBusy = useChatStore(
    (state) => state.status === "submitted" || state.status === "streaming"
  );
  const isSending = useRef(false);
  const submitOnEnter = useSubmitOnEnter();

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const content = value.trim();
      if (!content || isBusy || isSending.current || !sendMessage) {
        return;
      }
      // Guard resubmits before the store publishes its batched busy state.
      isSending.current = true;
      setValue("");
      try {
        await sendMessage({ text: content });
      } catch (error) {
        isSending.current = false;
        throw error;
      }
      isSending.current = false;
    },
    [isBusy, sendMessage, value]
  );

  const handleInputChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      setValue(event.currentTarget.value);
    },
    []
  );

  const handleStop = useCallback(async () => {
    // Closing the stream only stops this browser reading it; the run needs telling.
    await stop?.();
    if (threadId) {
      await stopThreadRun(threadId).catch(() => undefined);
    }
  }, [stop, threadId]);

  return (
    <form
      aria-label="Message composer"
      className={cn("w-full shrink-0 p-4 sm:p-5", className)}
      onSubmit={handleSubmit}
    >
      <InputGroup className="overflow-hidden">
        <InputGroupTextarea
          aria-describedby={describedBy ? `${describedBy} ${hintId}` : hintId}
          aria-label="Message"
          autoComplete="off"
          className="field-sizing-content scrollbar-subtle max-h-48 min-h-24"
          name="message"
          onChange={handleInputChange}
          placeholder="Describe what you’d like to change…"
          value={value}
          {...submitOnEnter}
        />
        <InputGroupAddon align="block-end" className="justify-between gap-2">
          <span className="text-muted-foreground text-xs" id={hintId}>
            Enter to send · Shift&nbsp;+&nbsp;Enter for a new line
          </span>
          {isBusy ? (
            <InputGroupButton
              aria-label="Stop Generating"
              className="size-11"
              onClick={handleStop}
              size="icon-sm"
              type="button"
              variant="default"
            >
              <SquareIcon />
            </InputGroupButton>
          ) : (
            <InputGroupButton
              aria-label="Send Message"
              className="size-11"
              disabled={!(sendMessage && value.trim())}
              size="icon-sm"
              type="submit"
              variant="default"
            >
              <ArrowUpIcon />
            </InputGroupButton>
          )}
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}
