"use client";

import { ArrowUpIcon } from "lucide-react";
import {
  type ChangeEvent,
  type CompositionEvent,
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useRef,
} from "react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { cn } from "@/lib/utils";

interface ChatComposerProps {
  className?: string;
  describedBy?: string;
  onSend: (content: string) => void;
  onValueChange: (value: string) => void;
  value: string;
}

/** Sends trimmed chat text on Enter while preserving Shift+Enter and IME confirmation. */
export function ChatComposer({
  className,
  describedBy,
  onSend,
  onValueChange,
  value,
}: ChatComposerProps) {
  const isComposing = useRef(false);

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const content = value.trim();
      if (!content) {
        return;
      }
      onSend(content);
    },
    [onSend, value]
  );

  const handleInputChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      onValueChange(event.currentTarget.value);
    },
    [onValueChange]
  );

  const handleInputComposition = useCallback(
    (event: CompositionEvent<HTMLTextAreaElement>) => {
      isComposing.current = event.type === "compositionstart";
    },
    []
  );

  const handleInputKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (
        event.defaultPrevented ||
        event.key !== "Enter" ||
        event.shiftKey ||
        isComposing.current ||
        event.nativeEvent.isComposing ||
        event.keyCode === 229
      ) {
        return;
      }
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
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
          onCompositionEnd={handleInputComposition}
          onCompositionStart={handleInputComposition}
          onKeyDown={handleInputKeyDown}
          placeholder="Describe what you'd like to change…"
          value={value}
        />
        <InputGroupAddon align="block-end" className="justify-between gap-2">
          <span className="text-muted-foreground text-xs">
            Enter to send · Shift + Enter for a new line
          </span>
          <InputGroupButton
            aria-label="Send message"
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
  );
}
