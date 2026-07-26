/**
 * 模型信息
 */

export interface ModelInfo {
  id: string;
  displayName: string;
  capabilities: {
    streaming: boolean;
    toolCalling: boolean;
    vision: boolean;
    reasoning: boolean;
  };
  contextWindow: number;
  maxOutputTokens: number;
  costFactor?: number;
}
