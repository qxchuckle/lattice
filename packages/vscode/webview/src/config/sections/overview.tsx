import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Row,
  Space,
  Statistic,
  Tag,
  Typography,
} from 'antd';
import {
  CloudSyncOutlined,
  DatabaseOutlined,
  FolderOpenOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { i18nT } from '@lattice-web-ui';
import { useConfig } from '../context';

function timeText(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function OverviewSection() {
  const { state, busy, runRag, openPath, openConfigFile, navigate, refresh } = useConfig();
  const { stats, rag, git, domains, runtime } = state;
  const activeProject = state.workspace
    .flatMap((workspace) => workspace.projects)
    .find((project) => project.active);
  const healthy =
    runtime.initialized && runtime.db.available && !runtime.db.error && runtime.watcher.healthy;

  return (
    <Space direction='vertical' size={16} style={{ width: '100%' }}>
      <Card>
        <Space wrap size={8} style={{ justifyContent: 'space-between', width: '100%' }}>
          <Space wrap>
            <Tag color={healthy ? 'green' : 'orange'}>
              {healthy ? i18nT('运行正常', 'Healthy') : i18nT('需要注意', 'Needs attention')}
            </Tag>
            <Typography.Text type='secondary'>
              {i18nT('当前用户', 'Current user')}: <strong>{state.user || '—'}</strong>
            </Typography.Text>
            {activeProject && (
              <Tag color='blue' title={activeProject.path}>
                {i18nT('当前项目', 'Active project')}: {activeProject.name}
              </Tag>
            )}
            <Typography.Text type='secondary' copyable={{ text: runtime.root }}>
              {runtime.root}
            </Typography.Text>
          </Space>
          <Space wrap>
            <Button icon={<FolderOpenOutlined />} onClick={() => openPath(runtime.root)}>
              {i18nT('打开数据目录', 'Open data folder')}
            </Button>
            <Button icon={<SettingOutlined />} onClick={() => void openConfigFile('global')}>
              {i18nT('打开全局配置', 'Open global config')}
            </Button>
            <Button
              icon={<ReloadOutlined />}
              loading={busy === 'refresh'}
              onClick={() => void refresh()}>
              {i18nT('刷新', 'Refresh')}
            </Button>
          </Space>
        </Space>
      </Card>

      {!state.initialized && (
        <Alert
          type='warning'
          showIcon
          message={i18nT('Lattice 尚未初始化', 'Lattice is not initialized')}
          description={i18nT(
            '请先在项目区块注册项目，或运行 ltc init 完成完整初始化。',
            'Register a project in the Projects section, or run ltc init for full setup.',
          )}
        />
      )}

      <Row gutter={[12, 12]}>
        <Col xs={12} md={6}>
          <Card size='small'>
            <Statistic title={i18nT('项目', 'Projects')} value={stats.projectCount} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size='small'>
            <Statistic
              title={i18nT('任务', 'Tasks')}
              value={stats.taskCount}
              suffix={
                <Typography.Text type='secondary' style={{ fontSize: 12 }}>
                  {i18nT('进行中', 'active')} {stats.activeTaskCount}
                </Typography.Text>
              }
            />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size='small'>
            <Statistic title={i18nT('规范', 'Specs')} value={stats.specCount} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size='small'>
            <Statistic title={i18nT('关系', 'Relations')} value={stats.relationCount} />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card
            title={
              <Space>
                <DatabaseOutlined />
                {i18nT('运行环境', 'Runtime')}
              </Space>
            }
            size='small'>
            <Descriptions column={1} size='small' colon={false}>
              <Descriptions.Item label={i18nT('扩展版本', 'Extension')}>
                {runtime.extensionVersion}
              </Descriptions.Item>
              <Descriptions.Item label={i18nT('核心版本', 'Core')}>
                {runtime.coreVersion}
              </Descriptions.Item>
              <Descriptions.Item label='VS Code'>{runtime.vscodeVersion}</Descriptions.Item>
              <Descriptions.Item label='Node'>{runtime.nodeVersion}</Descriptions.Item>
              <Descriptions.Item label={i18nT('数据库', 'Database')}>
                <Space>
                  <Tag color={runtime.db.available ? 'green' : 'red'}>
                    {runtime.db.available ? runtime.db.driver : 'unavailable'}
                  </Tag>
                  {runtime.db.sizeKB > 0 && `${runtime.db.sizeKB} KB`}
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label={i18nT('文件监听', 'Watcher')}>
                <Tag color={runtime.watcher.healthy ? 'green' : 'orange'}>
                  {runtime.watcher.healthy ? i18nT('正常', 'Healthy') : i18nT('降级', 'Degraded')}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label={i18nT('快照错误', 'Snapshot errors')}>
                {Object.keys(state.errors).length === 0 ? (
                  i18nT('无', 'None')
                ) : (
                  <Space wrap>
                    {Object.entries(state.errors).map(([section, message]) => (
                      <Tag key={section} color='red' title={message}>
                        {section}
                      </Tag>
                    ))}
                  </Space>
                )}
              </Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>

        <Col xs={24} lg={12}>
          <Card
            title={
              <Space>
                <ThunderboltOutlined />
                RAG
              </Space>
            }
            size='small'
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
              <Descriptions column={1} size='small' colon={false}>
                <Descriptions.Item label={i18nT('模型', 'Model')}>{rag.modelId}</Descriptions.Item>
                <Descriptions.Item label={i18nT('文档 / 向量', 'Docs / embeddings')}>
                  {rag.indexedDocuments} / {rag.totalEmbeddings}
                </Descriptions.Item>
                <Descriptions.Item label={i18nT('维度', 'Dimension')}>
                  {rag.vectorDimension}
                </Descriptions.Item>
                <Descriptions.Item label={i18nT('模型已安装', 'Model installed')}>
                  <Tag color={rag.modelInstalled ? 'green' : 'orange'}>
                    {rag.modelInstalled ? i18nT('是', 'Yes') : i18nT('否', 'No')}
                  </Tag>
                </Descriptions.Item>
                <Descriptions.Item label={i18nT('需要重建', 'Needs rebuild')}>
                  <Tag
                    color={
                      rag.modelChanged || rag.ftsIndexVersion !== rag.expectedFtsVersion
                        ? 'orange'
                        : 'green'
                    }>
                    {rag.modelChanged || rag.ftsIndexVersion !== rag.expectedFtsVersion
                      ? i18nT('是', 'Yes')
                      : i18nT('否', 'No')}
                  </Tag>
                </Descriptions.Item>
                <Descriptions.Item label={i18nT('最后更新', 'Last update')}>
                  {timeText(rag.lastUpdated)}
                </Descriptions.Item>
              </Descriptions>
            ) : (
              <Typography.Text type='secondary'>
                {i18nT(
                  'RAG 状态不可用（数据库未就绪）',
                  'RAG status unavailable (database not ready)',
                )}
              </Typography.Text>
            )}
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card
            title={
              <Space>
                <CloudSyncOutlined />
                {i18nT('主数据仓 Git', 'Data repo Git')}
              </Space>
            }
            size='small'
            extra={
              <Button size='small' onClick={() => navigate('users')}>
                {i18nT('管理', 'Manage')}
              </Button>
            }>
            <Descriptions column={1} size='small' colon={false}>
              <Descriptions.Item label={i18nT('已初始化', 'Initialized')}>
                <Tag color={git.status.initialized ? 'green' : 'orange'}>
                  {git.status.initialized ? i18nT('是', 'Yes') : i18nT('否', 'No')}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label={i18nT('分支', 'Branch')}>
                {git.status.branch ?? '—'}
              </Descriptions.Item>
              <Descriptions.Item label={i18nT('Remote', 'Remote')}>
                {git.status.remote ?? '—'}
              </Descriptions.Item>
              <Descriptions.Item label={i18nT('未提交变更', 'Changes')}>
                {git.status.changedFiles.length}
              </Descriptions.Item>
              <Descriptions.Item label={i18nT('领先 / 落后', 'Ahead / behind')}>
                {git.status.aheadCount} / {git.status.behindCount}
              </Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card
            title={
              <Space>
                <SafetyCertificateOutlined />
                {i18nT('同步域', 'Sync domains')}
              </Space>
            }
            size='small'
            extra={
              <Button size='small' onClick={() => navigate('users')}>
                {i18nT('管理', 'Manage')}
              </Button>
            }>
            {domains.length === 0 ? (
              <Typography.Text type='secondary'>
                {i18nT('尚未配置同步域。', 'No sync domains configured.')}
              </Typography.Text>
            ) : (
              <Space direction='vertical' size={6} style={{ width: '100%' }}>
                {domains.map((domain) => (
                  <Space
                    key={domain.hash}
                    wrap
                    style={{ justifyContent: 'space-between', width: '100%' }}>
                    <Typography.Text>{domain.label || domain.remote}</Typography.Text>
                    <Space>
                      <Tag>{domain.use}</Tag>
                      <Tag color={domain.lastSync?.status === 'error' ? 'red' : 'green'}>
                        {domain.lastSync?.status ?? i18nT('未同步', 'Never')}
                      </Tag>
                    </Space>
                  </Space>
                ))}
              </Space>
            )}
          </Card>
        </Col>
      </Row>
    </Space>
  );
}
