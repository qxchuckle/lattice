import { memo } from 'react';
import { t } from '../i18n';

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
      <SectionTitle>{t('节点结构', 'Node anatomy')}</SectionTitle>
      <MiniNode borderColor={COLOR.task}>
        <div style={{ fontWeight: 600 }}>{t('[Task] [进行中]', '[Task] [In Progress]')}</div>
        <div>{t('任务标题', 'Task title')}</div>
        <div style={{ color: 'var(--text-secondary)', fontSize: 10 }}>
          {t('@alice·域a1b2c3d4', '@alice · domain a1b2c3d4')}
        </div>
      </MiniNode>
      <div
        style={{
          fontSize: 11,
          color: 'var(--text-secondary)',
          marginTop: 6,
          lineHeight: 1.6,
        }}>
        {t(
          '第一行 [类型][状态/层级] · 第二行 标题 · 第三行（可选）@用户·来源',
          'Line 1 [type][status/scope] · Line 2 title · Line 3 (optional) @user · source',
        )}
      </div>

      <SectionTitle>{t('类型（边框/底色）', 'Types (border / fill)')}</SectionTitle>
      <LegendRow
        desc={
          <>
            <b>Task</b>
            {t(
              '（蓝）：任务，属性为状态（进行中/已完成/已归档/规划中）',
              ' (blue): tasks — status: In Progress / Completed / Archived / Planning',
            )}
          </>
        }>
        <MiniNode borderColor={COLOR.task}>[Task]</MiniNode>
      </LegendRow>
      <LegendRow
        desc={
          <>
            <b>Project</b>
            {t('（橙）：项目；', ' (orange): projects; ')}
            <code>[git]</code>
            {t(' 表示含 git 指纹', ' marks a git fingerprint')}
          </>
        }>
        <MiniNode borderColor={COLOR.project}>[Project]</MiniNode>
      </LegendRow>
      <LegendRow
        desc={
          <>
            <b>Spec</b>
            {t(
              '（青）：规范，属性为层级（全局/用户级/项目级）',
              ' (teal): specs — scope: global / user / project',
            )}
          </>
        }>
        <MiniNode borderColor={COLOR.spec}>[Spec]</MiniNode>
      </LegendRow>

      <SectionTitle>{t('来源（数据从哪来）', 'Source (where data comes from)')}</SectionTitle>
      <LegendRow
        desc={
          <>
            <b>{t('实线框', 'Solid border')}</b>
            {t(
              '：本机数据（主数据，唯一可写）。侧栏「来源」筛选可控制显示',
              ': local data (primary, writable). Toggle with the sidebar “Source” filter',
            )}
          </>
        }>
        <MiniNode borderColor={COLOR.spec} borderWidth={2}>
          {t('本机', 'Local')}
        </MiniNode>
      </LegendRow>
      <LegendRow
        desc={
          <>
            <b>{t('双线框', 'Double border')}</b>
            {t(
              '：域（经验包）数据——只读同步镜像，标签带 ',
              ': domain (knowledge pack) data — read-only sync mirror, labeled with ',
            )}
            <code>@user · domainHash</code>
            {t('。同名冲突时本地优先', '. Local data wins on name conflicts')}
          </>
        }>
        <MiniNode borderColor={COLOR.spec} borderStyle='double' borderWidth={4}>
          {t('域', 'Domain')}
        </MiniNode>
      </LegendRow>

      <SectionTitle>{t('连线', 'Edges')}</SectionTitle>
      <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.8 }}>
        <div>
          <b>{t('项目 → 任务', 'Project → Task')}</b>
          {t('（task）/ ', ' (task) / ')}
          <b>{t('项目 → Spec', 'Project → Spec')}</b>
          {t('（spec）：归属关系', ' (spec): ownership')}
        </div>
        <div>
          <b>{t('任务 → Spec', 'Task → Spec')}</b>
          {t('（ref-spec，青）：任务引用的规范', ' (ref-spec, teal): specs referenced by the task')}
        </div>
        <div>
          <b>{t('父子任务', 'Parent → child')}</b>
          {t('（parent，蓝）：任务拆分链', ' (parent, blue): task breakdown chain')}
        </div>
        <div>
          <b>{t('项目 ↔ 项目', 'Project ↔ Project')}</b>
          {t(
            '：项目间关系（依赖/组件共享等，depends-on 流动动画）',
            ': project relations (depends-on / shares-component, animated flow)',
          )}
        </div>
        <div>
          <b>{t('虚线', 'Dashed')}</b>
          {t(
            '（overrides 橙 / scope 橙）：Spec 层级覆盖链 / 任务附涉及路径',
            ' (overrides orange / scope orange): spec scope overrides / task scope paths',
          )}
        </div>
      </div>
    </div>
  );
});
