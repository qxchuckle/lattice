/**
 * 验证 Qoder SDK forkSession(upToMessageId) 的行为
 *
 * 测试点：
 * 1. upToMessageId 是 inclusive 还是 exclusive
 * 2. fork 后 getSessionMessages 返回哪些消息
 * 3. fork 后再 prompt 是否会导致 user 消息重复（通过检查 fork 后的消息列表推断）
 *
 * 运行：node scripts/verify-fork-behavior.mjs
 * 无需 API 调用，纯本地 JSONL 操作。
 */
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { forkSession, getSessionMessages } from '@qoder-ai/qoder-agent-sdk';

// ── 构造 mock session JSONL ──

const TEST_CWD = '/tmp/lattice-fork-test';
const sessionId = randomUUID();

// 模拟 qodercli 的 transcript 目录结构
// sanitizePath: 非字母数字字符替换为 '-'
const sanitized = TEST_CWD.replace(/[^a-zA-Z0-9]/g, '-');
const projectsDir = join(process.env.HOME, '.qoder', 'projects');
const sessionDir = join(projectsDir, sanitized);
const sessionFile = join(sessionDir, `${sessionId}.jsonl`);

// 消息 ID（message.id，用于 parentUuid 链）+ entry UUID（upToMessageId 用这个）
const uuid1 = randomUUID(); // user entry
const uuid2 = randomUUID(); // assistant entry 1
const uuid3 = randomUUID(); // assistant entry 2
const msgId1 = randomUUID(); // user: "修复 bug"
const msgId2 = randomUUID(); // assistant: "[Read file]"
const msgId3 = randomUUID(); // assistant: "修好了"

function entry(uuid, parentUuid, type, messageId, text) {
  return {
    uuid,
    parentUuid,
    isSidechain: false,
    userType: 'external',
    cwd: TEST_CWD,
    sessionId,
    version: '0.1.47',
    type,
    timestamp: new Date().toISOString(),
    message: {
      role: type,
      content: [{ type: 'text', text }],
      id: messageId,
    },
  };
}

const entries = [
  entry(uuid1, '', 'user', msgId1, '修复 auth 模块的 bug'),
  entry(uuid2, msgId1, 'assistant', msgId2, '让我先读取文件...[Read auth.ts]'),
  entry(uuid3, msgId2, 'assistant', msgId3, '修好了！我修复了登录验证的问题。'),
];

const jsonl = entries.map((e) => JSON.stringify(e)).join('\n') + '\n';

// ── 执行测试 ──

async function main() {
  console.log('=== Qoder SDK forkSession(upToMessageId) 行为验证 ===\n');

  // 准备 mock session
  await mkdir(sessionDir, { recursive: true });
  await writeFile(sessionFile, jsonl, 'utf-8');
  console.log(`Mock session: ${sessionId}`);
  console.log(`  [user]      msgId=${msgId1.slice(0, 8)}  "修复 auth 模块的 bug"`);
  console.log(`  [assistant] msgId=${msgId2.slice(0, 8)}  "让我先读取文件..."`);
  console.log(`  [assistant] msgId=${msgId3.slice(0, 8)}  "修好了！..."`);

  // 读取原始 session 的消息
  const originalMsgs = await getSessionMessages(sessionId, { dir: TEST_CWD });
  console.log(`\n原始 session 消息数: ${originalMsgs.length}`);
  for (const m of originalMsgs) {
    const text = m.message?.content?.[0]?.text ?? '';
    console.log(`  [${m.type}] uuid=${m.uuid.slice(0, 8)} "${text.slice(0, 30)}"`);
  }

  // 测试 1: fork 到 user 消息的 uuid（uuid1）
  console.log('\n--- 测试 1: forkSession(upToMessageId = user entry uuid) ---');
  try {
    const fork1 = await forkSession(sessionId, { upToMessageId: uuid1, dir: TEST_CWD });
    console.log(`Fork 成功: ${fork1.sessionId}`);
    const fork1Msgs = await getSessionMessages(fork1.sessionId, { dir: TEST_CWD });
    console.log(`Fork 后消息数: ${fork1Msgs.length}`);
    for (const m of fork1Msgs) {
      const text = m.message?.content?.[0]?.text ?? '';
      console.log(`  [${m.type}] "${text.slice(0, 40)}"`);
    }
    // 判断 inclusive/exclusive
    const hasUser = fork1Msgs.some((m) => m.type === 'user');
    const hasAssistant = fork1Msgs.some((m) => m.type === 'assistant');
    console.log(`\n结论: 包含 user 消息 = ${hasUser}, 包含 assistant 消息 = ${hasAssistant}`);
    if (hasUser && !hasAssistant) {
      console.log('→ upToMessageId 是 INCLUSIVE（包含该 user 消息，不含后续 assistant）');
      console.log('→ retry 场景：fork 后 user 消息已存在，再 prompt 同一消息会重复一条 user');
    } else if (!hasUser && !hasAssistant) {
      console.log('→ upToMessageId 是 EXCLUSIVE（不含该 user 消息）');
    } else {
      console.log('→ 截断未生效（可能 upToMessageId 未匹配）');
    }
  } catch (err) {
    console.log(`Fork 失败: ${err.message}`);
  }

  // 测试 2: fork 到第一个 assistant 消息的 uuid（uuid2）
  console.log('\n--- 测试 2: forkSession(upToMessageId = assistant entry uuid) ---');
  try {
    const fork2 = await forkSession(sessionId, { upToMessageId: uuid2, dir: TEST_CWD });
    console.log(`Fork 成功: ${fork2.sessionId}`);
    const fork2Msgs = await getSessionMessages(fork2.sessionId, { dir: TEST_CWD });
    console.log(`Fork 后消息数: ${fork2Msgs.length}`);
    for (const m of fork2Msgs) {
      const text = m.message?.content?.[0]?.text ?? '';
      console.log(`  [${m.type}] "${text.slice(0, 40)}"`);
    }
  } catch (err) {
    console.log(`Fork 失败: ${err.message}`);
  }

  // 清理
  await rm(sessionFile, { force: true });
  console.log('\n=== 验证完成（已清理 mock 文件） ===');
}

main().catch((err) => {
  console.error('测试失败:', err);
  process.exit(1);
});
