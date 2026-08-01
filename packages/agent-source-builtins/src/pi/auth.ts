/**
 * Pi 认证检测 + 模型发现
 */
import type { AuthStatus, ModelInfo } from '@qcqx/lattice-agent-protocol';

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
    // BYOK 单价展示（$ per M tokens，input/output）；两项均无价格时不生成
    const priceLabel = (cost?: { input?: number; output?: number }): string | undefined => {
      if (!cost || (!cost.input && !cost.output)) return undefined;
      const p = (n?: number) => parseFloat((n ?? 0).toFixed(2));
      return `$${p(cost.input)}/$${p(cost.output)}`;
    };
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
      costLabel: priceLabel(m.cost),
      // open 源：上下文窗口可自由设置（已知值作预设）；reasoning 模型开放思考深度（也可自由输入）
      tuning: {
        contextWindow: {
          options: m.contextWindow ? [m.contextWindow] : [],
          default: m.contextWindow ?? undefined,
          freeform: true,
        },
        ...(m.reasoning
          ? {
              thinking: {
                options: ['low', 'medium', 'high'],
                default: 'medium',
                toggleable: true,
                freeform: true,
              },
            }
          : {}),
      },
    }));
  } catch {
    return [];
  }
}
