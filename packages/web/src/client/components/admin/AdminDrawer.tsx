import { memo } from 'react';
import { Drawer, Tabs } from 'antd';
import { useSnapshot } from 'valtio';
import { adminStore, closeAdmin, type AdminTab } from '../../store';
import { useIsMobile } from '../../hooks';
import { OverviewTab } from './OverviewTab';
import { RagModelTab } from './RagModelTab';
import { DoctorTab } from './DoctorTab';
import { TrashTab } from './TrashTab';
import { ScanTab } from './ScanTab';
import { UserTab } from './UserTab';
import { GitSyncTab } from './GitSyncTab';

const tabItems: { key: AdminTab; label: string; children: React.ReactNode }[] = [
  { key: 'overview', label: '概览', children: <OverviewTab /> },
  { key: 'rag', label: 'RAG & 模型', children: <RagModelTab /> },
  { key: 'doctor', label: 'Doctor', children: <DoctorTab /> },
  { key: 'trash', label: '垃圾桶', children: <TrashTab /> },
  { key: 'scan', label: '扫描', children: <ScanTab /> },
  { key: 'user', label: '用户', children: <UserTab /> },
  { key: 'git', label: 'Git 同步', children: <GitSyncTab /> },
];

export const AdminDrawer = memo(function AdminDrawer() {
  const { open, activeTab } = useSnapshot(adminStore);
  const isMobile = useIsMobile();

  return (
    <Drawer
      title='管理'
      placement='right'
      open={open}
      onClose={closeAdmin}
      width={isMobile ? '100%' : 720}
      styles={{
        body: {
          padding: 0,
          height: '100%',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        },
      }}>
      <Tabs
        activeKey={activeTab}
        onChange={(key) => {
          adminStore.activeTab = key as AdminTab;
        }}
        items={tabItems}
        size='small'
        tabPosition={isMobile ? 'top' : 'left'}
        className={`admin-drawer-tabs${isMobile ? ' admin-drawer-tabs--top' : ''}`}
        style={{ height: '100%' }}
      />
    </Drawer>
  );
});
