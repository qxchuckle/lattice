/**
 * 消息与内容格式
 */

/** 多模态内容块（prompt 输入） */
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }
  | { type: 'file'; path: string; mimeType?: string };

/** 标准消息（LLM 交互的基本输入，源内部决定怎么用） */
export interface StandardMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: Array<{ id: string; name: string; args: Record<string, unknown> }>;
  toolResult?: { callId: string; result: unknown; isError?: boolean };
  timestamp?: number;
}
