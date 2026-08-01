/**
 * exhaustiveness 兜底：判别联合 switch 的 `default: assertNever(x)`。
 *
 * 独立零依赖模块——assertNever 不引用 ws/events/conversation 等任何类型，
 * 故依赖链较深的模块（如被 conversation 引用的 prompt-input）import 本函数
 * 不会引入循环（guards.ts 因 re-export ws/events 类型，被 prompt-input import 会成环）。
 *
 * 编译期：漏 case 时 x 收窄不到 never → 编译报错；
 * 运行时：被触达即为逻辑漏洞，抛错携带违规值便于定位。
 */
export function assertNever(value: never): never {
  throw new Error(`Unexpected discriminated union value: ${JSON.stringify(value)}`);
}
