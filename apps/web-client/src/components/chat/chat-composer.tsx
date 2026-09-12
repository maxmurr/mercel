"use client";

import { useChatStore } from "@ai-sdk-tools/store";
import { ArrowUpIcon, SquareIcon } from "lucide-react";
import {
  type ChangeEvent,
  type FormEvent,
  useCallback,
  useRef,
  useState,
} from "react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { useSubmitOnEnter } from "@/hooks/use-submit-on-enter";
import { cn } from "@/lib/utils";

interface ChatComposerProps {
  className?: string;
  describedBy?: string;
}

/** Sends trimmed chat text on Enter while preserving Shift+Enter and IME confirmation. */
export function ChatComposer({ className, describedBy }: ChatComposerProps) {
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

  return (
    <form
      aria-label="Message composer"
      className={cn("w-full shrink-0 p-4 sm:p-5", className)}
      onSubmit={handleSubmit}
    >
      <InputGroup className="overflow-hidden">
        <InputGroupTextarea
          aria-describedby={describedBy}
          aria-label="Message"
          className="field-sizing-content scrollbar-subtle max-h-48 min-h-24"
          name="message"
          onChange={handleInputChange}
          placeholder="Describe what you'd like to change…"
          value={value}
          {...submitOnEnter}
        />
        <InputGroupAddon align="block-end" className="justify-between gap-2">
          <span className="text-muted-foreground text-xs">
            Enter to send · Shift + Enter for a new line
          </span>
          {isBusy ? (
            <InputGroupButton
              aria-label="Stop generating"
              className="size-11"
              onClick={stop}
              size="icon-sm"
              type="button"
              variant="default"
            >
              <SquareIcon />
            </InputGroupButton>
          ) : (
            <InputGroupButton
              aria-label="Send message"
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
