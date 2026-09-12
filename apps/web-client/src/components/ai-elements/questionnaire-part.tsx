"use client";

import type {
  ChatAddToolApproveResponseFunction,
  DynamicToolUIPart,
  ToolUIPart,
} from "ai";
import { CheckIcon } from "lucide-react";
import { type FormEvent, useCallback, useState } from "react";
import type { z } from "zod";
import { isHiddenToolPart } from "@/components/ai-elements/tool";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoiceDescription,
  QuestionnaireChoices,
  QuestionnaireDescription,
  QuestionnaireError,
  QuestionnaireInput,
  QuestionnaireItem,
  QuestionnaireNext,
  QuestionnairePrevious,
  QuestionnaireProgress,
  QuestionnaireSkip,
  QuestionnaireSubmit,
  QuestionnaireTitle,
} from "@/components/ui/questionnaire";
import { Spinner } from "@/components/ui/spinner";
import {
  parseQuestionnaireAnswers,
  questionnaireInputSchema,
  questionnaireOutputSchema,
} from "@/features/chat/chat-questionnaire";

type QuestionnaireInputValue = z.infer<typeof questionnaireInputSchema>;

function QuestionnaireForm({
  approvalId,
  input,
  onApprovalResponse,
}: {
  approvalId: string;
  input: QuestionnaireInputValue;
  onApprovalResponse: ChatAddToolApproveResponseFunction;
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const items = input.questions.map((question) => ({
    choices:
      question.type === "text"
        ? []
        : question.options.map((option) => ({
            disabled: isSubmitting,
            value: option.label,
          })),
    name: question.id,
    required: question.required,
  }));

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (isSubmitting) {
        return;
      }
      const data = new FormData(event.currentTarget);
      const answers = Object.fromEntries(
        input.questions.map((question) => {
          const values = data
            .getAll(question.id)
            .map(String)
            .map((value) => value.trim())
            .filter(Boolean);
          const answer = question.type === "multi_select" ? values : values[0];
          return [question.id, values.length ? answer : null];
        })
      );
      try {
        const output = parseQuestionnaireAnswers(input, { answers });
        setIsSubmitting(true);
        setError(undefined);
        await onApprovalResponse({
          approved: true,
          id: approvalId,
          reason: JSON.stringify(output),
        });
      } catch {
        setIsSubmitting(false);
        setError("Could not send answers. Check your choices and try again.");
      }
    },
    [approvalId, input, isSubmitting, onApprovalResponse]
  );

  return (
    <Questionnaire
      aria-label="Questions from the assistant"
      items={items}
      onSubmit={handleSubmit}
      shortcuts="numbers"
    >
      <QuestionnaireProgress />
      {input.questions.map((question) => (
        <QuestionnaireItem
          key={question.id}
          multiple={question.type === "multi_select"}
          name={question.id}
          required={question.required}
        >
          <QuestionnaireTitle>{question.question}</QuestionnaireTitle>
          {question.description ? (
            <QuestionnaireDescription>
              {question.description}
            </QuestionnaireDescription>
          ) : null}
          {question.type === "text" ? (
            <QuestionnaireInput
              aria-label={question.question}
              disabled={isSubmitting}
              maxLength={4000}
              placeholder={question.placeholder}
            />
          ) : (
            <QuestionnaireChoices>
              {question.options.map((option) => (
                <QuestionnaireChoice
                  disabled={isSubmitting}
                  key={option.label}
                  value={option.label}
                >
                  {option.label}
                  {option.description ? (
                    <QuestionnaireChoiceDescription>
                      {option.description}
                    </QuestionnaireChoiceDescription>
                  ) : null}
                </QuestionnaireChoice>
              ))}
            </QuestionnaireChoices>
          )}
          <QuestionnaireError>
            {question.type === "text"
              ? "Enter an answer or skip this question if optional."
              : "Choose an answer to continue."}
          </QuestionnaireError>
        </QuestionnaireItem>
      ))}
      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
      <QuestionnaireActions className="@max-xs:grid-cols-2">
        <QuestionnairePrevious disabled={isSubmitting} />
        <QuestionnaireSkip disabled={isSubmitting} />
        <QuestionnaireNext
          className="@max-xs:col-start-2"
          disabled={isSubmitting}
        />
        <QuestionnaireSubmit
          className="@max-xs:col-span-2 @max-xs:col-start-1 @max-xs:row-start-2 h-auto @max-xs:w-full min-w-0 max-w-full whitespace-normal"
          disabled={isSubmitting}
        >
          {isSubmitting ? "Sending…" : input.submitLabel}
        </QuestionnaireSubmit>
      </QuestionnaireActions>
    </Questionnaire>
  );
}

/** Renders ask_user as a stepped form and collapses only confirmed tool output to an answer summary. */
export function QuestionnairePart({
  onApprovalResponse,
  part,
}: {
  onApprovalResponse?: ChatAddToolApproveResponseFunction | undefined;
  part: ToolUIPart | DynamicToolUIPart;
}) {
  if (isHiddenToolPart(part)) {
    return null;
  }
  const input = questionnaireInputSchema.safeParse(part.input).data;
  if (part.state === "output-available" && input) {
    const output = questionnaireOutputSchema.safeParse(part.output).data;
    if (!output) {
      return null;
    }
    return (
      <Bubble className="max-w-full" variant="outline">
        <BubbleContent className="flex min-w-0 flex-col gap-2">
          <Marker role="status">
            <MarkerIcon>
              <CheckIcon />
            </MarkerIcon>
            <MarkerContent>Answers sent</MarkerContent>
          </Marker>
          <dl className="flex min-w-0 flex-col gap-1 text-base sm:text-sm">
            {input.questions.map((question) => {
              const answer = output.answers[question.id];
              return (
                <div
                  className="flex min-w-0 flex-wrap gap-x-2"
                  key={question.id}
                >
                  <dt className="text-muted-foreground">{question.label}</dt>
                  <dd className="wrap-anywhere min-w-0">
                    {Array.isArray(answer)
                      ? answer.join(", ")
                      : answer || "No preference"}
                  </dd>
                </div>
              );
            })}
          </dl>
        </BubbleContent>
      </Bubble>
    );
  }
  const approval =
    part.state === "approval-requested" ? part.approval : undefined;
  if (approval && !onApprovalResponse) {
    return (
      <Marker>
        <MarkerContent>This questionnaire is no longer active.</MarkerContent>
      </Marker>
    );
  }
  return (
    <Bubble className="@container w-full max-w-lg" variant="outline">
      <BubbleContent className="wrap-anywhere min-w-0">
        {input && approval && onApprovalResponse ? (
          <QuestionnaireForm
            approvalId={approval.id}
            input={input}
            onApprovalResponse={onApprovalResponse}
          />
        ) : (
          <Marker role="status">
            <MarkerIcon>
              <Spinner className="motion-reduce:animate-none" />
            </MarkerIcon>
            <MarkerContent>
              {part.state === "approval-responded"
                ? "Sending answers…"
                : "Preparing questions…"}
            </MarkerContent>
          </Marker>
        )}
      </BubbleContent>
    </Bubble>
  );
}
