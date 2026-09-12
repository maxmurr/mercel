import type { UIMessage } from "ai";

export interface ChatThread {
  isStreaming: boolean;
  messages: UIMessage[];
  resourceId: string;
}

export interface ChatThreadSummary {
  deploymentId?: string | undefined;
  id: string;
  title: string;
  updatedAt: string;
}
