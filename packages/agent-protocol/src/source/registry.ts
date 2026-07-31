/**
 * 注册表接口 + 工厂配置
 *
 * Registry 职责：注册/发现/manifest 聚合/生命周期。不代理运行时调用（prompt/fork），
 * 消费层直接操作源实例。旧同步僵尸 API（listModels/checkAuth/getBuiltinTools 同步版）已删除：
 * 动态事实走源实例的异步通道，静态声明走 manifest。
 */
import type { AggregatedSourceResources, SourceResourceQuery } from './resources.js';
import type { ISource, LatticeSourceMap } from './interface.js';
import type { ResolvedManifest } from './manifest.js';

export interface ISourceRegistry {
  register(source: ISource): void;
  unregister(id: string): void;

  /** typed getSource：声明合并后源 ID 编译期收紧 + 返回精确类型；未知 ID 回退 ISource */
  getSource<K extends keyof LatticeSourceMap & string>(id: K): LatticeSourceMap[K] | undefined;
  getSource(id: string): ISource | undefined;

  /** 全部源的握手产物（含 available:false 的失败源）；未握手的源不在列 */
  listManifests(): ResolvedManifest[];
  /** 单源 manifest（握手缓存） */
  getManifest(id: string): ResolvedManifest | undefined;
  /** 重新握手（登录态变更/SDK 升级后调用），返回新 manifest 并更新缓存 */
  rehandshake(id: string): Promise<ResolvedManifest>;

  /** 运行时熔断：标记源不可用（getSource 过滤；恢复走 markAvailable/rehandshake 成功） */
  markUnavailable(id: string, reason: string): void;
  /** 解除熔断 */
  markAvailable(id: string): void;
  /** 查询熔断原因（未熔断 = undefined） */
  getUnavailableReason(id: string): string | undefined;

  /** 聚合资源发现：指定源只查该源，不指定查全部；统一返回按源分组映射 +
   *  枚举失败清单（未实现/能力关 = []，失败 = [] + warnings 条目，UI 据此提示用户） */
  listResources(sourceId?: string, query?: SourceResourceQuery): Promise<AggregatedSourceResources>;

  /** init + handshake 全部源：并行（allSettled），单源失败落 manifest.available=false，不炸整体 */
  initAll(): Promise<void>;
  disposeAll(): Promise<void>;
}

export interface AgentSourceConfig {
  /** 要加载的源（不传 = 加载所有内置源） */
  sources?: ISource[];
  /** 默认源 ID */
  defaultSource?: string;
  /** 默认模型 */
  defaultModel?: string;
}
