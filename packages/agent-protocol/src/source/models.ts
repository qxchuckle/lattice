/**
 * 模型信息
 */

/**
 * 单个可调参数的规格（数据驱动 web 渲染：有规格才渲染控件，前端零源类型判断）
 */
export interface ModelParamSpec<T extends string | number> {
  /** 可选值列表（空 = 无预设，仅 freeform 时可自由输入） */
  options: T[];
  /** 默认值（未选择时源使用的值，UI 标注"默认"） */
  default?: T;
  /** 允许自由输入（open 源/自定义模型） */
  freeform?: boolean;
}

/**
 * 模型可调参数（源声明，随模型列表下发）：
 * 未提供某项 = 该模型不支持调节该参数，web 不渲染对应控件
 */
export interface ModelTuning {
  /** 上下文窗口（tokens） */
  contextWindow?: ModelParamSpec<number>;
  /**
   * 思考深度；toggleable = 可整体关闭。
   * 关闭时客户端以哨兵值 'none' 表达（落盘保留供 retry/continue 复用），
   * 编排层进入源前归一化为不传——源永远不会收到 'none'。
   */
  thinking?: ModelParamSpec<string> & { toggleable?: boolean };
}

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
  /**
   * 费率展示文本（源生成，web 零判断直接渲染）：
   * 积分制源用倍率（'1.1x'），BYOK 源用单价（'$3/$15'，隐含 per M tokens）
   */
  costLabel?: string;
  /** 可调参数规格（数据控制渲染） */
  tuning?: ModelTuning;
}
