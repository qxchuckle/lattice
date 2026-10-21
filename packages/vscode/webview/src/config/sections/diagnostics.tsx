import { useState } from 'react';
import { Alert, App, Button, Card, Checkbox, Descriptions, Space, Tag, Typography } from 'antd';
import {
  CopyOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { i18nT } from '@lattice-web-ui';
import { useConfig } from '../context';
import { bridgeAction } from '../../host';

export function DiagnosticsSection() {
  const {
    state,
    busy,
    ragProgress,
    runDoctor,
    runRag,
    copyDiagnostics,
    openPath,
    openConfigFile,
    refresh,
  } = useConfig();
  const { message, modal } = App.useApp();
  const [doctorReport, setDoctorReport] = useState<unknown>(null);
  const [doctorFix, setDoctorFix] = useState(false);
  const { rag, runtime } = state;

  const run = async () => {
    try {
      const report = await runDoctor(doctorFix);
      if (report === undefined) return;
      setDoctorReport(report);
      message.success(
        doctorFix
          ? i18nT('体检修复完成', 'Health check with fix complete')
          : i18nT('体检完成', 'Health check complete'),
      );
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <Space direction='vertical' size={16} style={{ width: '100%' }}>
      <Card
        size='small'
        title={
          <Space>
            <SafetyCertificateOutlined />
            {i18nT('运行诊断', 'Runtime diagnostics')}
          </Space>
        }
        extra={
          <Space>
            <Button size='small' icon={<CopyOutlined />} onClick={() => void copyDiagnostics()}>
              {i18nT('复制诊断', 'Copy diagnostics')}
            </Button>
            <Button
              size='small'
              icon={<ReloadOutlined />}
              loading={busy === 'refresh'}
              onClick={() => void refresh()}>
              {i18nT('刷新', 'Refresh')}
            </Button>
          </Space>
        }>
        <Descriptions column={2} size='small' colon={false}>
          <Descriptions.Item label={i18nT('扩展', 'Extension')}>
            {runtime.extensionVersion}
          </Descriptions.Item>
          <Descriptions.Item label={i18nT('核心', 'Core')}>{runtime.coreVersion}</Descriptions.Item>
          <Descriptions.Item label='VS Code'>{runtime.vscodeVersion}</Descriptions.Item>
          <Descriptions.Item label='Node'>{runtime.nodeVersion}</Descriptions.Item>
          <Descriptions.Item label={i18nT('平台', 'Platform')}>
            {runtime.platform}
          </Descriptions.Item>
          <Descriptions.Item label={i18nT('数据根', 'Data root')}>
            <Typography.Text copyable={{ text: runtime.root }}>{runtime.root}</Typography.Text>
          </Descriptions.Item>
          <Descriptions.Item label={i18nT('数据库', 'Database')}>
            <Space>
              <Tag color={runtime.db.available ? 'green' : 'red'}>{runtime.db.driver}</Tag>
              {runtime.db.sizeKB} KB
            </Space>
          </Descriptions.Item>
          <Descriptions.Item label={i18nT('文件监听', 'Watcher')}>
            <Tag color={runtime.watcher.healthy ? 'green' : 'orange'}>
              {runtime.watcher.healthy ? i18nT('正常', 'Healthy') : i18nT('降级', 'Degraded')}
            </Tag>
          </Descriptions.Item>
        </Descriptions>
        <Space wrap style={{ marginTop: 12 }}>
          <Button size='small' icon={<FolderOpenOutlined />} onClick={() => openPath(runtime.root)}>
            {i18nT('打开数据目录', 'Open data folder')}
          </Button>
          <Button
            size='small'
            icon={<FileTextOutlined />}
            onClick={() => void openConfigFile('global')}>
            {i18nT('打开全局配置', 'Open global config')}
          </Button>
          <Button
            size='small'
            icon={<FileTextOutlined />}
            onClick={() => void openConfigFile('local')}>
            {i18nT('打开本机配置', 'Open local config')}
          </Button>
          <Button
            size='small'
            icon={<FileTextOutlined />}
            onClick={() => bridgeAction('executeCommand', { command: 'lattice.logs.show' })}>
            {i18nT('查看日志', 'Show logs')}
          </Button>
          <Button
            size='small'
            onClick={() => {
              modal.confirm({
                title: i18nT('重新加载窗口？', 'Reload window?'),
                content: i18nT(
                  '用于数据根或扩展状态变更后重新初始化。',
                  'Reinitialize after data-root or extension changes.',
                ),
                onOk: () =>
                  bridgeAction('executeCommand', { command: 'workbench.action.reloadWindow' }),
              });
            }}>
            {i18nT('重新加载窗口', 'Reload window')}
          </Button>
        </Space>
      </Card>

      <Card
        size='small'
        title={
          <Space>
            <ThunderboltOutlined />
            RAG
          </Space>
        }
        extra={
          <Space>
            <Button
              size='small'
              loading={busy === 'rag-update'}
              onClick={() => void runRag({ action: 'update' })}>
              {i18nT('增量更新', 'Update')}
            </Button>
            <Button
              size='small'
              loading={busy === 'rag-rebuild'}
              onClick={() => void runRag({ action: 'rebuild' })}>
              {i18nT('重建索引', 'Rebuild')}
            </Button>
          </Space>
        }>
        {rag ? (
          <Descriptions column={2} size='small' colon={false}>
            <Descriptions.Item label={i18nT('模型', 'Model')}>{rag.modelId}</Descriptions.Item>
            <Descriptions.Item label={i18nT('上次索引模型', 'Last indexed model')}>
              {rag.lastModelId ?? '—'}
            </Descriptions.Item>
            <Descriptions.Item label={i18nT('文档数', 'Documents')}>
              {rag.indexedDocuments}
            </Descriptions.Item>
            <Descriptions.Item label={i18nT('向量数', 'Embeddings')}>
              {rag.totalEmbeddings}
            </Descriptions.Item>
            <Descriptions.Item label={i18nT('维度', 'Dimension')}>
              {rag.vectorDimension}
            </Descriptions.Item>
            <Descriptions.Item label={i18nT('向量库', 'Vector store')}>
              <Tag color={rag.vectorStoreReady ? 'green' : 'orange'}>
                {rag.vectorStoreReady ? i18nT('就绪', 'Ready') : i18nT('未就绪', 'Not ready')}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label={i18nT('FTS 版本', 'FTS version')}>
              {rag.ftsIndexVersion} / {rag.expectedFtsVersion}
            </Descriptions.Item>
            <Descriptions.Item label={i18nT('模型已安装', 'Model installed')}>
              <Tag color={rag.modelInstalled ? 'green' : 'orange'}>
                {rag.modelInstalled ? i18nT('是', 'Yes') : i18nT('否', 'No')}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label={i18nT('最后更新', 'Last update')}>
              {rag.lastUpdated ? new Date(rag.lastUpdated).toLocaleString() : '—'}
            </Descriptions.Item>
            <Descriptions.Item label={i18nT('数据库路径', 'DB path')}>
              <Typography.Text copyable={{ text: rag.dbPath }} style={{ fontSize: 12 }}>
                {rag.dbPath}
              </Typography.Text>
            </Descriptions.Item>
          </Descriptions>
        ) : (
          <Typography.Text type='secondary'>
            {i18nT('RAG 状态不可用', 'RAG status unavailable')}
          </Typography.Text>
        )}
        {ragProgress && ragProgress.phase === 'progress' && (
          <Alert
            style={{ marginTop: 12 }}
            type='info'
            showIcon
            message={`${ragProgress.current ?? 0}/${ragProgress.total ?? 0}`}
            description={ragProgress.message}
          />
        )}
      </Card>

      <Card
        size='small'
        title={i18nT('健康体检', 'Health check')}
        extra={
          <Space>
            <Checkbox checked={doctorFix} onChange={(event) => setDoctorFix(event.target.checked)}>
              {i18nT('修复', 'Fix')}
            </Checkbox>
            <Button
              size='small'
              type='primary'
              loading={busy === 'doctor'}
              onClick={() => void run()}>
              {i18nT('运行体检', 'Run health check')}
            </Button>
          </Space>
        }>
        {doctorReport ? (
          <pre
            style={{
              margin: 0,
              maxHeight: 360,
              overflow: 'auto',
              fontSize: 12,
              padding: 12,
              background: 'var(--bg-secondary)',
              borderRadius: 6,
            }}>
            {JSON.stringify(doctorReport, null, 2)}
          </pre>
        ) : (
          <Typography.Text type='secondary'>
            {i18nT('尚未运行体检。', 'No health check has been run yet.')}
          </Typography.Text>
        )}
      </Card>

      <Card size='small' title={i18nT('快照错误', 'Snapshot errors')}>
        {Object.keys(state.errors).length === 0 ? (
          <Typography.Text type='secondary'>{i18nT('无错误', 'No errors')}</Typography.Text>
        ) : (
          <Space direction='vertical' style={{ width: '100%' }}>
            {Object.entries(state.errors).map(([section, error]) => (
              <Alert key={section} type='error' showIcon message={section} description={error} />
            ))}
          </Space>
        )}
      </Card>
    </Space>
  );
}
