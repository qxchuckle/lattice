/**
 * Qoder prompt 入参构造（纯函数）
 */
import type { ContentBlock } from '@qcqx/lattice-agent-protocol';

/**
 * 构造 query 的 prompt 入参：纯文本走字符串；含图片时走 streaming-input
 *（单条 SDKUserMessage，Anthropic MessageParam content 数组含 image base64 block）。
 * 返回工厂：resume 失败重试需要全新的 AsyncIterable（旧 generator 已被消费）。
 */
export function makeQoderPrompt(message: ContentBlock[]): () => string | AsyncIterable<unknown> {
  const images = message.filter(
    (b): b is Extract<ContentBlock, { type: 'image' }> => b.type === 'image',
  );
  const text = message
    .filter((b) => b.type !== 'image')
    .map((b) => (b.type === 'text' ? b.text : `[${b.type}]`))
    .join('\n');
  if (images.length === 0) return () => text;

  const content = [
    ...(text ? [{ type: 'text', text }] : []),
    ...images.map((b) => ({
      type: 'image',
      source: { type: 'base64', media_type: b.mimeType, data: b.data },
    })),
  ];
  return () =>
    (async function* () {
      yield { type: 'user', message: { role: 'user', content }, parent_tool_use_id: null };
    })();
}
