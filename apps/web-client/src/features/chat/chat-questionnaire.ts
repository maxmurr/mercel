import { type DynamicToolUIPart, getToolName, type ToolUIPart } from "ai";
import { z } from "zod";

const questionFields = {
  description: z.string().optional(),
  id: z.string().min(1),
  label: z.string().min(1).describe("Short label for the answer summary."),
  question: z.string().min(1),
  required: z.boolean().default(true),
};
const questionOptions = z
  .array(
    z.object({
      description: z.string().optional(),
      label: z.string().min(1),
    })
  )
  .min(1)
  .max(9)
  .refine(
    (options) =>
      new Set(options.map((option) => option.label)).size === options.length,
    "Questionnaire option labels must be unique."
  );

/** Shared ask_user contract for the agent, questionnaire UI, and resume validation. */
export const questionnaireInputSchema = z.object({
  questions: z
    .array(
      z.discriminatedUnion("type", [
        z.object({
          ...questionFields,
          options: questionOptions,
          type: z.literal("single_select"),
        }),
        z.object({
          ...questionFields,
          options: questionOptions,
          type: z.literal("multi_select"),
        }),
        z.object({
          ...questionFields,
          placeholder: z.string().optional(),
          type: z.literal("text"),
        }),
      ])
    )
    .min(1)
    .max(8)
    .refine(
      (questions) =>
        new Set(questions.map((question) => question.id)).size ===
        questions.length,
      "Questionnaire question IDs must be unique."
    ),
  submitLabel: z.string().min(1).max(40).default("Send answers"),
});

/** Null means the user explicitly skipped an optional question. */
export const questionnaireOutputSchema = z.object({
  answers: z.record(
    z.string(),
    z.union([z.string(), z.array(z.string()), z.null()])
  ),
});

export function isQuestionnairePart(part: ToolUIPart | DynamicToolUIPart) {
  return getToolName(part) === "ask_user";
}

/** Validates answers against the stored questions, never a browser-supplied choice list. */
export function parseQuestionnaireAnswers(
  input: z.infer<typeof questionnaireInputSchema>,
  output: unknown
) {
  const fields = input.questions.map((question) => {
    const value =
      question.type === "text"
        ? z.string().trim().min(1).max(4000)
        : z.enum(question.options.map((option) => option.label));
    const answer =
      question.type === "multi_select"
        ? z
            .array(value)
            .min(1)
            .refine((values) => new Set(values).size === values.length)
        : value;
    return [
      question.id,
      question.required ? answer : answer.nullable(),
    ] as const;
  });
  return z
    .object({ answers: z.object(Object.fromEntries(fields)).strict() })
    .strict()
    .parse(output);
}
