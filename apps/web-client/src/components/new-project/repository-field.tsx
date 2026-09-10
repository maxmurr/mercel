"use client";

import { useCallback, useId, useState } from "react";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";

/** Collects a public GitHub repository URL using native form validation. */
export function RepositoryField({ disabled }: { disabled: boolean }) {
  const id = useId();
  const [invalid, setInvalid] = useState(false);
  const clearValidationError = useCallback(() => setInvalid(false), []);
  const showValidationError = useCallback(() => setInvalid(true), []);

  return (
    <Field data-disabled={disabled} data-invalid={invalid}>
      <FieldLabel htmlFor={id}>GitHub Repository URL</FieldLabel>
      <Input
        aria-describedby={`${id}-description${invalid ? ` ${id}-error` : ""}`}
        aria-invalid={invalid}
        autoCapitalize="none"
        autoComplete="off"
        className="min-h-11"
        disabled={disabled}
        id={id}
        name="repoUrl"
        onChange={clearValidationError}
        onInvalid={showValidationError}
        pattern={"https://github\\.com/[A-Za-z0-9\\-]+/[A-Za-z0-9._\\-]+/?"}
        placeholder="https://github.com/owner/repository"
        required
        spellCheck={false}
        type="url"
      />
      <FieldDescription id={`${id}-description`}>
        Enter a public repository URL. Its default branch will be deployed.
      </FieldDescription>
      {Boolean(invalid) && (
        <FieldError id={`${id}-error`}>
          Enter a GitHub URL like https://github.com/owner/repository.
        </FieldError>
      )}
    </Field>
  );
}
