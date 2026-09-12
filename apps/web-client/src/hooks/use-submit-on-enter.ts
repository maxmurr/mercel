"use client";

import {
  type CompositionEvent,
  type KeyboardEvent,
  useCallback,
  useRef,
} from "react";

const IME_KEY_CODE = 229;

interface SubmitOnEnterProps {
  onCompositionEnd: (event: CompositionEvent<HTMLTextAreaElement>) => void;
  onCompositionStart: (event: CompositionEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
}

/** Spreads onto a textarea to submit its form on Enter, leaving Shift+Enter and IME confirmation alone. */
export function useSubmitOnEnter(): SubmitOnEnterProps {
  const isComposing = useRef(false);

  const handleComposition = useCallback(
    (event: CompositionEvent<HTMLTextAreaElement>) => {
      isComposing.current = event.type === "compositionstart";
    },
    []
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (
        event.defaultPrevented ||
        event.key !== "Enter" ||
        event.shiftKey ||
        isComposing.current ||
        event.nativeEvent.isComposing ||
        event.keyCode === IME_KEY_CODE
      ) {
        return;
      }
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    },
    []
  );

  return {
    onCompositionEnd: handleComposition,
    onCompositionStart: handleComposition,
    onKeyDown: handleKeyDown,
  };
}
