import { memo } from 'react';

/**
 * 画布图例（灵动岛「?」按钮弹出）：mini 节点 div 示例讲解节点结构与视觉编码。
 * 颜色与 graph/stylesheet.ts 保持同步：Task 蓝 / Project 橙 / Spec 青；域节点双线框。
 */

const COLOR = {
  task: 'var(--entity-task)',
  project: 'var(--entity-project)',
  spec: 'var(--entity-spec)',
};

/** mini 节点示例：按真实节点标签结构渲染（[类型][属性] 标题 @用户） */
function MiniNode({
  borderColor,
  borderStyle = 'solid',
  borderWidth = 2,
  children,
}: {
  borderColor: string;
  borderStyle?: 'solid' | 'double';
  borderWidth?: number;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: 'inline-block',
        padding: '6px 10px',
        borderRadius: 6,
        border: `${borderWidth}px ${borderStyle} ${borderColor}`,
        background: 'color-mix(in srgb, var(--entity-spec) 8%, transparent)',
        fontSize: 11,
        lineHeight: 1.5,
        textAlign: 'center',
        color: 'var(--text)',
      }}>
      {children}
    </div>
  );
}

function LegendRow({ children, desc }: { children: React.ReactNode; desc: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10 }}>
      <div style={{ flexShrink: 0 }}>{children}</div>
      <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{desc}</div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div style={{ fontWeight: 600, fontSize: 12, margin: '10px 0 8px' }}>{children}</div>;
}

export const GraphLegend = memo(function GraphLegend() {
  return (
    <div style={{ maxWidth: 420 }}>
      <SectionTitle>节点结构</SectionTitle>
      <MiniNode borderColor={COLOR.task}>
        <div style={{ fontWeight: 600 }}>[Task] [进行中]</div>
        <div>任务标题</div>
        <div style={{ color: 'var(--text-secondary)', fontSize: 10 }}>@alice·域a1b2c3d4</div>
      </MiniNode>
      <div
        style={{
          fontSize: 11,
          color: 'var(--text-secondary)',
          marginTop: 6,
          lineHeight: 1.6,
        }}>
        第一行 [类型][状态/层级] · 第二行 标题 · 第三行（可选）@用户·来源
      </div>

      <SectionTitle>类型（边框/底色）</SectionTitle>
      <LegendRow
        desc={
          <>
            <b>Task</b>（蓝）：任务，属性为状态（进行中/已完成/已归档/规划中）
          </>
        }>
        <MiniNode borderColor={COLOR.task}>[Task]</MiniNode>
      </LegendRow>
      <LegendRow
        desc={
          <>
            <b>Project</b>（橙）：项目；<code>[git]</code> 表示含 git 指纹
          </>
        }>
        <MiniNode borderColor={COLOR.project}>[Project]</MiniNode>
      </LegendRow>
      <LegendRow
        desc={
          <>
            <b>Spec</b>（青）：规范，属性为层级（全局/用户级/项目级）
          </>
        }>
        <MiniNode borderColor={COLOR.spec}>[Spec]</MiniNode>
      </LegendRow>

      <SectionTitle>来源（数据从哪来）</SectionTitle>
      <LegendRow
        desc={
          <>
            <b>实线框</b>：本机数据（主数据，唯一可写）。侧栏「来源」筛选可控制显示
          </>
        }>
        <MiniNode borderColor={COLOR.spec} borderWidth={2}>
          本机
        </MiniNode>
      </LegendRow>
      <LegendRow
        desc={
          <>
            <b>双线框</b>：域（经验包）数据——只读同步镜像，标签带 <code>@用户·域hash</code>。
            同名冲突时本地优先
          </>
        }>
        <MiniNode borderColor={COLOR.spec} borderStyle='double' borderWidth={4}>
          域
        </MiniNode>
      </LegendRow>

      <SectionTitle>连线</SectionTitle>
      <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.8 }}>
        <div>
          <b>项目 → 任务</b>（task）/ <b>项目 → Spec</b>（spec）：归属关系
        </div>
        <div>
          <b>任务 → Spec</b>（ref-spec，青）：任务引用的规范
        </div>
        <div>
          <b>父子任务</b>（parent，蓝）：任务拆分链
        </div>
        <div>
          <b>项目 ↔ 项目</b>：项目间关系（依赖/组件共享等，depends-on 流动动画）
        </div>
        <div>
          <b>虚线</b>（overrides 橙 / scope 橙）：Spec 层级覆盖链 / 任务附涉及路径
        </div>
      </div>
    </div>
  );
});
