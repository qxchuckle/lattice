/**
 * 验证节点状态机的视图投影规则（deriveTurnStatus，client 侧单一真相）
 *
 * 投影优先级：undone > hidden > error(内容) > interrupted > done
 * 运行：node_modules/.bin/tsx scripts/verify-state-machine.mts
 */
import { deriveTurnStatus } from '../packages/web/src/client/components/agent/turnState.js';
import {
  isReadOnly,
  canApplyOperation,
  shouldSkipDescendantMark,
  isBranchableChild,
  projectViewStatus,
} from '@qcqx/lattice-agent-protocol';
import type { ConversationNode, NodeContent } from '@qcqx/lattice-agent-protocol';

let passed = 0;
let failed = 0;
function assert(cond: boolean, name: string) {
  console.log(`  ${cond ? '✓' : '✗'} ${name}`);
  cond ? passed++ : failed++;
}

function makeNode(
  status: ConversationNode['status'],
  content: NodeContent[] = [],
): ConversationNode {
  return {
    id: 'n',
    parentId: null,
    branchId: 'b',
    role: 'assistant',
    content,
    timestamp: Date.now(),
    status,
  };
}

const user = makeNode(undefined);
const text: NodeContent[] = [{ type: 'text', text: 'hi' }];
const errContent: NodeContent[] = [
  { type: 'text', text: 'hi' },
  { type: 'error', message: 'boom' },
];

console.log('视图投影优先级验证：');
assert(deriveTurnStatus(user, makeNode(undefined, text)) === 'done', 'active + 无错误 → done');
assert(
  deriveTurnStatus(user, makeNode('interrupted', text)) === 'interrupted',
  'interrupted + 无错误 → interrupted（继续）',
);
assert(
  deriveTurnStatus(user, makeNode('interrupted', errContent)) === 'error',
  'interrupted + error 内容 → error（error 优先，修复点）',
);
assert(
  deriveTurnStatus(user, makeNode(undefined, errContent)) === 'error',
  'active + error 内容 → error',
);
assert(
  deriveTurnStatus(makeNode('undone'), makeNode('undone', text)) === 'undone',
  'undone → undone',
);
assert(
  deriveTurnStatus(makeNode('hidden'), makeNode('hidden', text)) === 'hidden',
  'hidden → hidden',
);
assert(
  deriveTurnStatus(makeNode('undone'), makeNode('undone', errContent)) === 'undone',
  'undone + error → undone（结构态优先于 error）',
);
assert(
  deriveTurnStatus(makeNode('hidden'), makeNode('hidden', errContent)) === 'hidden',
  'hidden + error → hidden（结构态优先于 error）',
);
assert(deriveTurnStatus(user, undefined) === 'done', '无 assistant（仅 user）→ done');
assert(
  deriveTurnStatus(user, makeNode('interrupted', [])) === 'interrupted',
  'interrupted 空内容（首 token 前中止）→ interrupted',
);

console.log('\n共享状态机（protocol/node-state）验证：');
assert(isReadOnly('undone') && isReadOnly('hidden'), 'isReadOnly: undone/hidden 为只读');
assert(
  !isReadOnly('active') && !isReadOnly('interrupted') && !isReadOnly(undefined),
  'isReadOnly: active/interrupted/默认非只读',
);
assert(
  canApplyOperation('undo', 'active') && canApplyOperation('undo', 'interrupted'),
  'undo 可作用于 active/interrupted',
);
assert(
  !canApplyOperation('undo', 'undone') && !canApplyOperation('undo', 'hidden'),
  'undo 不作用于 undone/hidden',
);
assert(canApplyOperation('delete', 'undone'), 'delete 可作用于 undone（undone→hidden 合法）');
assert(!canApplyOperation('delete', 'hidden'), 'delete 不作用于已 hidden');
assert(
  !canApplyOperation('retry', 'undone') && !canApplyOperation('retry', 'hidden'),
  'retry 不作用于 undone/hidden',
);
assert(
  !canApplyOperation('continue', 'undone') && !canApplyOperation('continue', 'hidden'),
  'continue 不作用于 undone/hidden',
);
assert(shouldSkipDescendantMark('undone', 'hidden'), 'undo 标记跳过 hidden 后代（不复活）');
assert(
  !shouldSkipDescendantMark('undone', 'active') && !shouldSkipDescendantMark('undone', 'undone'),
  'undo 标记不跳过 active/undone',
);
assert(
  !shouldSkipDescendantMark('hidden', 'hidden') && !shouldSkipDescendantMark('hidden', 'active'),
  'delete 标记不跳过任何后代',
);
assert(isBranchableChild('active') && isBranchableChild(undefined), 'auto-fork 计入活跃子节点');
assert(
  !isBranchableChild('undone') && !isBranchableChild('hidden'),
  'auto-fork 不计入 undone/hidden 子节点',
);
assert(projectViewStatus('undone', true) === 'undone', 'projectViewStatus: undone 优先于 error');
assert(
  projectViewStatus('interrupted', true) === 'error',
  'projectViewStatus: error 优先于 interrupted',
);
assert(
  projectViewStatus('interrupted', false) === 'interrupted',
  'projectViewStatus: 无 error 的 interrupted',
);
assert(projectViewStatus(undefined, false) === 'done', 'projectViewStatus: 默认 done');

console.log(`\n=== 结果: ${passed} 通过, ${failed} 失败 ===`);
if (failed > 0) process.exit(1);
