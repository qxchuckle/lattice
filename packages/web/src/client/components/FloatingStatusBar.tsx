import { Button, Segmented } from 'antd';
import {
  ReloadOutlined,
  BulbOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  AimOutlined,
} from '@ant-design/icons';
import { useSnapshot } from 'valtio';
import { canvasStore, sidebarStore, themeStore, toggleTheme } from '../store';
import { useStats } from '../hooks';

const layoutOptions: { label: string; value: string; icon: React.ReactNode }[] = [
  { label: '力导向', value: 'force', icon: <AimOutlined /> },
  { label: '顺序', value: 'sequential', icon: <MenuFoldOutlined /> },
  { label: '径向', value: 'radial', icon: <ReloadOutlined /> },
];

/** 顶部浮动状态岛：侧栏开关 + 布局切换 + 统计 + 刷新 + 主题 */
export function FloatingStatusBar() {
  const { mode } = useSnapshot(themeStore);
  const { collapsed: sidebarCollapsed } = useSnapshot(sidebarStore);
  const { layoutMode } = useSnapshot(canvasStore);
  const stats = useStats();
  const isDark = mode === 'dark';

  return (
    <div
      style={{
        position: 'absolute',
        top: 12,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 20,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '5px 12px',
        background: isDark ? 'rgba(29, 29, 38, 0.88)' : 'rgba(255, 255, 255, 0.88)',
        backdropFilter: 'blur(12px)',
        border: `1px solid ${isDark ? '#3D3D48' : '#E0E0E0'}`,
        borderRadius: 24,
        boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
        fontSize: 12,
      }}>
      <Button
        size='small'
        type='text'
        icon={sidebarCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
        onClick={() => {
          sidebarStore.collapsed = !sidebarCollapsed;
        }}
        style={{ borderRadius: '50%' }}
      />
      <Segmented
        size='small'
        options={layoutOptions.map((opt) => ({
          label: (
            <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 11 }}>
              {opt.icon}
              {opt.label}
            </span>
          ),
          value: opt.value,
        }))}
        value={layoutMode}
        onChange={(v) => {
          canvasStore.layoutMode = v as 'force' | 'sequential' | 'radial';
        }}
      />
      {stats.data && (
        <span style={{ color: 'var(--text-secondary)', whiteSpace: 'nowrap', fontSize: 11 }}>
          {stats.data.projectCount} 项目 · {stats.data.taskCount} 任务 ·{' '}
          {stats.data.activeTaskCount} 进行中
        </span>
      )}
      <Button
        size='small'
        type='text'
        icon={<ReloadOutlined />}
        onClick={() => window.location.reload()}
        style={{ borderRadius: '50%' }}
      />
      <Button
        size='small'
        type='text'
        icon={<BulbOutlined />}
        onClick={toggleTheme}
        style={{ borderRadius: '50%' }}
      />
    </div>
  );
}
