import { createTool } from "@mastra/core/tools";
import {
  parseQuestionnaireAnswers,
  questionnaireInputSchema,
  questionnaireOutputSchema,
} from "../../features/chat/chat-questionnaire";

export const askUserTool = createTool({
  description:
    "Ask the user for decisions needed before continuing. Group related questions into one questionnaire with single-select, multi-select, or text answers. Use short summary labels, helpful option descriptions, and required: false for optional questions. Do not ask about details you can reasonably infer.",
  execute: async (input, context) => {
    if (context?.agent?.resumeData !== undefined) {
      return parseQuestionnaireAnswers(input, context.agent.resumeData);
    }
    if (!context?.agent?.suspend) {
      throw new Error(
        "Questionnaire requires an agent run to collect answers."
      );
    }
    return await context.agent.suspend(input);
  },
  id: "ask_user",
  inputSchema: questionnaireInputSchema,
  outputSchema: questionnaireOutputSchema,
  resumeSchema: questionnaireOutputSchema,
  suspendSchema: questionnaireInputSchema,
});
