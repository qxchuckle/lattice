/**
 * Pi 认证检测 + 模型发现
 */
import type { AuthStatus, ModelInfo } from '../../types.js';

export async function checkPiAuth(): Promise<AuthStatus> {
  try {
    const { existsSync } = await import('node:fs');
    const { homedir } = await import('node:os');
    const { join } = await import('node:path');

    const authPath = join(homedir(), '.pi', 'agent', 'auth.json');
    if (existsSync(authPath)) {
      return { status: 'configured', detail: 'auth.json found' };
    }

    const envKeys = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'DEEPSEEK_API_KEY', 'GEMINI_API_KEY'];
    const found = envKeys.filter((k) => process.env[k]);
    if (found.length > 0) {
      return { status: 'configured', detail: `env: ${found.join(', ')}` };
    }

    return { status: 'missing', message: '请配置 API Key 或运行 pi /login' };
  } catch {
    return { status: 'missing', message: '无法检测认证状态' };
  }
}

export async function discoverPiModels(): Promise<ModelInfo[]> {
  try {
    const { createModels } = await import('@earendil-works/pi-ai');
    const models = createModels();
    const available = models.getModels();
    return available.map((m) => ({
      id: `${m.provider}/${m.id}`,
      displayName: m.name ?? m.id,
      capabilities: {
        streaming: true,
        toolCalling: true,
        vision: Array.isArray(m.input) && m.input.includes('image'),
        reasoning: Boolean(m.reasoning),
      },
      contextWindow: m.contextWindow ?? 128000,
      maxOutputTokens: m.maxTokens ?? 16384,
    }));
  } catch {
    return [];
  }
}
