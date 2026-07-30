/**
 * MinimalHost —— 用三个包搭一个完整 agent 宿主，本文件是「宿主自己要写的全部代码」
 *
 * 三包各管一段：
 * - protocol：契约（ISource / SourceEvent / capabilities）
 * - source：把 SDK 翻译成 ISource（driver + 握手）
 * - pipeline：把能力翻译成行为（策略表 + 管线 + polyfill middleware）
 *
 * 宿主只剩两件事：**会话簿记**（threadId ↔ 源会话 ID）与**呈现**。
 * 能力差异消化、slash 展开、skills 注入、能力守卫全部白拿——本文件里没有一处
 * `if (sourceId === 'pi')` 之类的源判断，这就是「多宿主复用」的验收标准。
 */
import type {
  ISource,
  ISourceRegistry,
  SourceEvent,
  ContentBlock,
  PromptOpts,
} from '@qcqx/lattice-agent-protocol';
import { projectNodeCapabilities } from '@qcqx/lattice-agent-protocol';
import { lastValueFrom, toArray } from 'rxjs';
import {
  resolveSourceProfile,
  runPrompt,
  planFork,
  executeForkPlan,
  type SourceProfile,
  type PipelineNotice,
} from '@qcqx/lattice-agent-pipeline';

/** 一个会话线程的簿记（宿主唯一需要持有的状态） */
interface Thread {
  sourceId: string;
  /** 源侧会话 ID；首轮之前为 null */
  sessionId: string | null;
  /** 最后一轮的源消息 ID（fork 锚点） */
  lastMessageId?: string;
}

export interface HostTurn {
  text: string;
  events: SourceEvent[];
  notices: string[];
}

export class MinimalHost {
  private readonly threads = new Map<string, Thread>();
  private readonly profiles = new Map<string, SourceProfile>();
  /** 本轮降级提示缓冲：profile 解析一次即冻结，notice 靠这个 sink 流出来 */
  private turnNotices: string[] = [];

  constructor(
    private readonly registry: ISourceRegistry,
    private readonly options: {
      resolveCommandTemplate?: (name: string) => Promise<string | null>;
      listSkills?: () => Promise<{ name: string; description?: string }[]>;
    } = {},
  ) {}

  /** 握手产物 → profile（会话期冻结；登录态变化后宿主可重调） */
  async prepare(sourceId: string): Promise<SourceProfile> {
    const manifest = this.registry.getManifest(sourceId);
    if (!manifest) throw new Error(`源 ${sourceId} 尚未握手`);
    const profile = resolveSourceProfile(manifest, {
      resolveCommandTemplate: this.options.resolveCommandTemplate,
      listSkills: this.options.listSkills,
      catalog: manifest.modelsSnapshot,
      onNotice: (n: PipelineNotice) => this.turnNotices.push(n.message),
    });
    this.profiles.set(sourceId, profile);
    return profile;
  }

  createThread(threadId: string, sourceId: string): void {
    this.threads.set(threadId, { sourceId, sessionId: null });
  }

  /** 发一轮消息：管线负责能力适配，宿主只更新簿记 */
  async send(threadId: string, message: ContentBlock[], opts: PromptOpts = {}): Promise<HostTurn> {
    const thread = this.mustGet(threadId);
    const profile = this.profiles.get(thread.sourceId) ?? (await this.prepare(thread.sourceId));
    const source = this.mustGetSource(thread.sourceId);

    this.turnNotices = [];
    // pipeline runPrompt 返回 Observable<SourceEvent>；订阅收集全部事件（入向失败 → reject）。
    const events: SourceEvent[] = await lastValueFrom(
      runPrompt({
        source,
        payload: { sessionId: thread.sessionId, message, opts },
        middlewares: profile.middlewares,
      }).pipe(toArray()),
    );

    let text = '';
    for (const event of events) {
      if (event.type === 'text') text += event.content;
      if (event.type === 'notice') this.turnNotices.push(event.message);
    }
    // 从 done 事件提取会话翻新（代替旧 stream.result()；done 必携 sessionId）
    const done = events.find((e) => e.type === 'done');
    if (done && done.type === 'done') {
      thread.sessionId = done.sessionId ?? null;
      thread.lastMessageId = done.sourceMessageId;
    }
    return { text, events, notices: this.turnNotices };
  }

  /** 从某条消息分叉：能力不足时 pipeline 给出近似计划或拒绝，宿主照做即可 */
  async fork(
    threadId: string,
    newThreadId: string,
    atMessage?: string,
  ): Promise<HostTurn['notices']> {
    const thread = this.mustGet(threadId);
    if (!thread.sessionId) throw new Error('会话尚未建立，无法分叉');
    const profile = this.profiles.get(thread.sourceId) ?? (await this.prepare(thread.sourceId));
    const plan = planFork(profile.capabilities.session.fork, {
      sessionId: thread.sessionId,
      atMessage: atMessage ?? thread.lastMessageId,
    });
    const { newSessionId, notices } = await executeForkPlan(
      this.mustGetSource(thread.sourceId),
      plan,
    );
    this.threads.set(newThreadId, { sourceId: thread.sourceId, sessionId: newSessionId });
    return notices;
  }

  /** UI 渲染用：节点能力投影（server 与 client 同一函数，绕过 UI 直调行为一致） */
  nodeCapabilities(threadId: string, status: Parameters<typeof projectNodeCapabilities>[0]) {
    const thread = this.mustGet(threadId);
    const profile = this.profiles.get(thread.sourceId);
    return projectNodeCapabilities(status, profile?.projection);
  }

  private mustGet(threadId: string): Thread {
    const thread = this.threads.get(threadId);
    if (!thread) throw new Error(`未知会话 ${threadId}`);
    return thread;
  }

  private mustGetSource(sourceId: string): ISource {
    const source = this.registry.getSource(sourceId);
    if (!source) throw new Error(`未注册源 ${sourceId}`);
    return source;
  }
}
