import { memo, useState, useCallback } from 'react';
import { Button, Tag, List, Spin, App, Switch, Space, Divider, Tooltip } from 'antd';
import { MedicineBoxOutlined, ToolOutlined, ReloadOutlined } from '@ant-design/icons';
import type { DoctorReport } from '@qcqx/lattice-core';
import { getAdapter } from '../../adapters';

const STATUS_COLOR: Record<string, string> = {
  healthy: 'green',
  stale: 'orange',
  error: 'red',
  repaired: 'blue',
};

const STATUS_ICON: Record<string, string> = {
  healthy: '✓',
  stale: '⚠',
  error: '✗',
  repaired: '↻',
};

export const DoctorTab = memo(function DoctorTab() {
  const { message } = App.useApp();
  const [report, setReport] = useState<DoctorReport | null>(null);
  const [running, setRunning] = useState(false);
  const [fix, setFix] = useState(false);
  const [migrate, setMigrate] = useState(false);
  const [rebuildFingerprints, setRebuildFingerprints] = useState(false);
  const [recheckScopePaths, setRecheckScopePaths] = useState(false);

  const handleRun = useCallback(async () => {
    setRunning(true);
    try {
      const result = await getAdapter().runDoctor({
        fix,
        migrate,
        rebuildFingerprints,
        recheckScopePaths,
      });
      setReport(result);
      message.success(
        `检查完成：${result.healthy} 健康，${result.stale} 待修复${result.repaired ? `，${result.repaired} 已修复` : ''}`,
      );
    } catch (err) {
      message.error(`诊断失败: ${(err as Error).message}`);
    } finally {
      setRunning(false);
    }
  }, [fix, migrate, rebuildFingerprints, recheckScopePaths, message]);

  return (
    <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div>
        <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 6 }}>诊断选项</div>
        <Space wrap>
          <Tooltip title='开启后自动修复可安全修复的项（如创建缺失目录）'>
            <Switch
              checkedChildren='修复'
              unCheckedChildren='检查'
              checked={fix}
              onChange={setFix}
            />
          </Tooltip>
          <Tooltip title='将旧 single-path/single-remote 项目数据升级为多路径数组格式'>
            <Switch
              checkedChildren='迁移'
              unCheckedChildren='迁移'
              checked={migrate}
              onChange={setMigrate}
              size='small'
            />
          </Tooltip>
          <Tooltip title='重新采集所有项目的 git 指纹（首次 commit / remote URL 等）'>
            <Switch
              checkedChildren='指纹'
              unCheckedChildren='指纹'
              checked={rebuildFingerprints}
              onChange={setRebuildFingerprints}
              size='small'
            />
          </Tooltip>
          <Tooltip title='重新检查所有任务的 scopePaths 是否已属于某个已注册项目，若有则提升为关联项目'>
            <Switch
              checkedChildren='scopePaths'
              unCheckedChildren='scopePaths'
              checked={recheckScopePaths}
              onChange={setRecheckScopePaths}
              size='small'
            />
          </Tooltip>
        </Space>
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>
          开启相应选项后点击「运行诊断」执行对应操作。
        </div>
      </div>

      <Divider style={{ margin: '4px 0' }} />

      <Space>
        <Button type='primary' icon={<MedicineBoxOutlined />} loading={running} onClick={handleRun}>
          {fix ? '诊断并修复' : '运行诊断'}
        </Button>
        {report && (
          <Button icon={<ReloadOutlined />} onClick={() => setReport(null)}>
            清除
          </Button>
        )}
      </Space>

      {running && (
        <div style={{ textAlign: 'center', padding: 24 }}>
          <Spin tip='正在检查...' />
        </div>
      )}

      {report && !running && (
        <>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            共 {report.total} 项：
            <Tag color='green'>{report.healthy} 健康</Tag>
            {report.stale > 0 && <Tag color='orange'>{report.stale} 待修复</Tag>}
            {report.error > 0 && <Tag color='red'>{report.error} 错误</Tag>}
            {report.repaired > 0 && <Tag color='blue'>{report.repaired} 已修复</Tag>}
          </div>
          <List
            size='small'
            dataSource={report.entries}
            renderItem={(entry) => (
              <List.Item>
                <div style={{ width: '100%' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 14 }}>{STATUS_ICON[entry.status] ?? '•'}</span>
                    <span style={{ fontWeight: 500 }}>{entry.item}</span>
                    <Tag color={STATUS_COLOR[entry.status]} style={{ marginLeft: 'auto' }}>
                      {entry.status}
                    </Tag>
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: 'var(--text-secondary)',
                      marginTop: 2,
                      paddingLeft: 22,
                    }}>
                    {entry.message}
                  </div>
                  {entry.fix && entry.status !== 'healthy' && entry.status !== 'repaired' && (
                    <div
                      style={{
                        fontSize: 11,
                        color: 'var(--text-tertiary)',
                        marginTop: 2,
                        paddingLeft: 22,
                      }}>
                      <ToolOutlined /> {entry.fix}
                    </div>
                  )}
                </div>
              </List.Item>
            )}
          />
        </>
      )}

      {!report && !running && (
        <div
          style={{ textAlign: 'center', padding: 24, color: 'var(--text-tertiary)', fontSize: 13 }}>
          点击「运行诊断」检查 Lattice 健康状况
        </div>
      )}
    </div>
  );
});
