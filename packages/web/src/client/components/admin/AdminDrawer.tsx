import { memo } from 'react';
import { Drawer, Tabs } from 'antd';
import { useSnapshot } from 'valtio';
import { adminStore, closeAdmin, type AdminTab } from '../../store';
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

  return (
    <Drawer
      title='管理'
      placement='right'
      open={open}
      onClose={closeAdmin}
      width={720}
      styles={{ body: { padding: 0 } }}>
      <Tabs
        activeKey={activeTab}
        onChange={(key) => {
          adminStore.activeTab = key as AdminTab;
        }}
        items={tabItems}
        size='small'
        tabPosition='left'
        style={{ height: '100%' }}
        tabBarStyle={{ position: 'sticky', top: 0, overflow: 'visible' }}
      />
    </Drawer>
  );
});
