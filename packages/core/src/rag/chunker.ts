/**
 * Markdown 标题分片器
 *
 * 按所有级别标题（# ~ ######）拆分 markdown 文档。
 * 每个 chunk = 该标题下的直接内容（不含子标题段）。
 * 维护 parent-child 关系和 heading_path。
 */

export interface MarkdownChunk {
  /** chunk 在文档内的序号（0-based） */
  chunkIndex: number;
  /** 标题级别（1-6），0 = 无标题文档 */
  headingLevel: number;
  /** 完整路径："标题 > 章节 > 子节" */
  headingPath: string;
  /** 仅当前标题文本 */
  headingTitle: string;
  /** 父 chunk 的 chunkIndex，null = 顶层 */
  parentChunkIndex: number | null;
  /** 该标题下的直接内容（不含子标题段） */
  content: string;
}

/** 解析 markdown 标题级别，返回 0-6（0 = 不是标题） */
function parseHeadingLevel(line: string): number {
  const match = line.match(/^(#{1,6})\s+/);
  return match ? match[1].length : 0;
}

/** 提取标题文本（去掉 # 前缀） */
function parseHeadingText(line: string): string {
  return line.replace(/^#{1,6}\s+/, '').trim();
}

/**
 * 将 markdown 内容按标题分片
 * @param content markdown 全文（含或不含 frontmatter）
 * @param docTitle 文档标题（用于无标题文档和 heading_path 根）
 * @param minChunkSize 最小 chunk 字符数（默认 50），小于此值的 chunk 并入父级
 * @returns chunk 数组
 */
export function chunkMarkdown(
  content: string,
  docTitle: string,
  minChunkSize = 50,
): MarkdownChunk[] {
  // 去掉 YAML frontmatter
  const fmMatch = content.match(/^---\n[\s\S]*?\n---\n/);
  const body = fmMatch ? content.slice(fmMatch[0].length) : content;

  const lines = body.split('\n');
  const chunks: MarkdownChunk[] = [];

  // 标题栈：跟踪当前路径
  // stack[i] = { level, title, chunkIndex }
  const headingStack: { level: number; title: string; chunkIndex: number }[] = [];

  let currentChunkIndex = -1;
  let currentLevel = 0;
  let currentContent: string[] = [];
  let inCodeBlock = false;

  /** 将当前积累的 content 作为一个 chunk 提交 */
  function flushChunk(): void {
    if (currentChunkIndex < 0) return;

    const content = currentContent.join('\n').trim();

    // 构建 heading_path
    const pathParts: string[] = [];
    let parentChunkIndex: number | null = null;

    for (const item of headingStack) {
      pathParts.push(item.title);
      if (item.level < currentLevel) {
        parentChunkIndex = item.chunkIndex;
      }
    }

    // 如果没有标题栈（无标题文档），用 docTitle
    const headingPath = pathParts.length > 0 ? pathParts.join(' > ') : docTitle;
    const headingTitle =
      headingStack.length > 0 ? headingStack[headingStack.length - 1].title : docTitle;

    chunks.push({
      chunkIndex: currentChunkIndex,
      headingLevel: currentLevel,
      headingPath,
      headingTitle,
      parentChunkIndex,
      content,
    });

    currentContent = [];
  }

  for (const line of lines) {
    // 检测代码块
    if (line.trim().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      if (currentChunkIndex >= 0) {
        currentContent.push(line);
      } else {
        currentContent.push(line);
      }
      continue;
    }

    // 在代码块内，不解析标题
    if (inCodeBlock) {
      if (currentChunkIndex >= 0) {
        currentContent.push(line);
      } else {
        currentContent.push(line);
      }
      continue;
    }

    const level = parseHeadingLevel(line);

    if (level > 0) {
      // 遇到新标题：先 flush 当前 chunk
      flushChunk();

      // 弹出栈中 >= 当前级别的标题
      while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
        headingStack.pop();
      }

      currentChunkIndex++;
      currentLevel = level;
      currentContent = [];

      const title = parseHeadingText(line);
      headingStack.push({ level, title, chunkIndex: currentChunkIndex });
    } else {
      // 普通内容行
      if (currentChunkIndex >= 0) {
        currentContent.push(line);
      } else {
        // 标题前的内容（如文档开头的引言），创建一个隐式 chunk
        currentChunkIndex = 0;
        currentLevel = 0;
        currentContent = [line];
      }
    }
  }

  // flush 最后一个 chunk
  flushChunk();

  // 过滤空内容 chunk
  const nonEmpty = chunks.filter((chunk) => chunk.content.length > 0);

  // 合并过小 chunk 到父级
  if (minChunkSize <= 0) return nonEmpty;
  return mergeSmallChunks(nonEmpty, minChunkSize);
}

/** 将内容过小的 chunk 合并到父级 chunk */
function mergeSmallChunks(chunks: MarkdownChunk[], minSize: number): MarkdownChunk[] {
  if (chunks.length <= 1) return chunks;

  // 构建 chunkIndex → 数组位置映射
  const indexToPos = new Map<number, number>();
  chunks.forEach((c, i) => indexToPos.set(c.chunkIndex, i));

  const result: MarkdownChunk[] = [];
  const merged = new Set<number>(); // 已被合并掉的 chunk
  // chunkIndex 映射：旧索引 → 合并后的父级旧索引
  const mergeTarget = new Map<number, number>();

  for (const chunk of chunks) {
    if (merged.has(chunk.chunkIndex)) continue;

    // 如果 chunk 太小且有父级，合并到父级
    if (chunk.content.length < minSize && chunk.parentChunkIndex !== null) {
      const parentPos = indexToPos.get(chunk.parentChunkIndex);
      if (parentPos !== undefined) {
        const parent = chunks[parentPos];
        // 将子 chunk 内容追加到父级
        parent.content = parent.content + '\n\n' + chunk.headingTitle + '\n' + chunk.content;
        merged.add(chunk.chunkIndex);
        mergeTarget.set(chunk.chunkIndex, chunk.parentChunkIndex);
        continue;
      }
    }

    result.push(chunk);
  }

  // 修正 parentChunkIndex：指向被合并 chunk 的，重定向到其合并目标
  const resolveMergeTarget = (idx: number): number | null => {
    const target = mergeTarget.get(idx);
    if (target === undefined) return idx; // 未被合并
    // 递归查找最终目标（父级也可能被合并了）
    return resolveMergeTarget(target);
  };

  for (const chunk of result) {
    if (chunk.parentChunkIndex !== null) {
      chunk.parentChunkIndex = resolveMergeTarget(chunk.parentChunkIndex);
    }
  }

  // 重新编号 chunkIndex，并构建旧→新映射
  const oldToNew = new Map<number, number>();
  result.forEach((c, i) => {
    oldToNew.set(c.chunkIndex, i);
    c.chunkIndex = i;
  });
  // 更新 parentChunkIndex 为新编号
  for (const chunk of result) {
    if (chunk.parentChunkIndex !== null) {
      chunk.parentChunkIndex = oldToNew.get(chunk.parentChunkIndex) ?? null;
    }
  }

  return result;
}
