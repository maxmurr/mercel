import type { Processor } from "@mastra/core/processors";

/** Design brief prepended to the conversation's first user message so the model reads it as the user's own ask. */
export const designBrief = `For all designs I ask you to make, have them be beautiful, not cookie cutter. Make webpages that are fully featured and worthy for production.

By default, this template supports JSX syntax with Tailwind CSS classes, React hooks, and Lucide React for icons. Do not install other packages for UI themes, icons, etc unless absolutely necessary or I request them.

Use icons from lucide-react for logos.

Use stock photos from unsplash where appropriate, only valid URLs you know exist. Do not download the images, only link to them in image tags.

`;

export const designBriefProcessor = {
  id: "design-brief",
  processInput({ messages }) {
    const firstUserMessage = messages.find(
      (message) => message.role === "user"
    );
    const textPart = firstUserMessage?.content.parts.find(
      (part) => part.type === "text"
    );
    // Skip when the brief is already there so replayed history is not prefixed twice.
    if (textPart && !textPart.text.startsWith(designBrief)) {
      textPart.text = `${designBrief}${textPart.text}`;
    }
    return messages;
  },
} satisfies Processor;
