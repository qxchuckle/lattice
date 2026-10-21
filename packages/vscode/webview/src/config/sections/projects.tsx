import { useMemo, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  Empty,
  Input,
  Modal,
  Progress,
  Radio,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import {
  CheckOutlined,
  FolderOpenOutlined,
  PlusOutlined,
  ReloadOutlined,
  ScanOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { i18nT } from '@lattice-web-ui';
import { useConfig } from '../context';
import type {
  ConfigProjectRow,
  ConfigWorkspaceProject,
  ConfigWorkspaceState,
} from '@qcqx/lattice-protocol';

const stateColor: Record<ConfigWorkspaceState['state'], string> = {
  registered: 'green',
  'registered-via-git': 'green',
  'unregistered-git': 'orange',
  'unregistered-anchor': 'orange',
  'unregistered-no-anchor': 'red',
  nested: 'blue',
};

function stateText(value: ConfigWorkspaceState['state']): string {
  switch (value) {
    case 'registered':
      return i18nT('已注册（锚点）', 'Registered (anchor)');
    case 'registered-via-git':
      return i18nT('已注册（Git）', 'Registered (Git)');
    case 'unregistered-git':
      return i18nT('未注册 Git 项目', 'Unregistered Git project');
    case 'unregistered-anchor':
      return i18nT('未注册（有锚点）', 'Unregistered (anchor)');
    case 'unregistered-no-anchor':
      return i18nT('未注册（无锚点）', 'Unregistered (no anchor)');
    case 'nested':
      return i18nT('嵌套在已注册项目内', 'Nested in a registered project');
  }
}

export function ProjectsSection() {
  const {
    state,
    busy,
    scanProgress,
    scan,
    cancelScan,
    registerProject,
    updateProject,
    pickDirectories,
    openPath,
    openGraph,
    switchProject,
    refresh,
  } = useConfig();
  const { message } = App.useApp();
  const [dirs, setDirs] = useState<string[]>(() => {
    const saved = ((state.core.local.scanDirs as string[] | undefined) ?? []).slice();
    return saved.length > 0 ? saved : state.workspace.map((workspace) => workspace.folder);
  });
  const [saveAsDefault, setSaveAsDefault] = useState(true);
  const [registerTarget, setRegisterTarget] = useState<ConfigWorkspaceProject | null>(null);
  const [registerAnchor, setRegisterAnchor] = useState(false);
  const [registerFolder, setRegisterFolder] = useState(false);
  const [editing, setEditing] = useState<ConfigProjectRow | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editTags, setEditTags] = useState<string[]>([]);
  const [editGroups, setEditGroups] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);

  const scanning =
    busy === 'scan' || scanProgress?.phase === 'start' || scanProgress?.phase === 'progress';
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return state.projects;
    return state.projects.filter((project) =>
      [project.name, project.id, project.localPaths.join(' '), project.tags.join(' ')]
        .join(' ')
        .toLowerCase()
        .includes(query),
    );
  }, [search, state.projects]);

  const openRegister = (project: ConfigWorkspaceProject) => {
    setRegisterTarget(project);
    setRegisterAnchor(false);
    setRegisterFolder(!project.isRoot);
  };

  const submitRegister = async () => {
    if (!registerTarget) return;
    const git = Boolean(registerTarget.gitRoot);
    const target = registerTarget.anchorRoot ? 'folder' : registerFolder ? 'folder' : 'git-root';
    const result = await registerProject({
      path: registerTarget.path,
      target,
      createAnchor: registerTarget.anchorRoot ? false : git ? registerAnchor : true,
    });
    if (result) {
      message.success(
        i18nT(
          result.created ? '项目已注册' : '项目已更新',
          result.created ? 'Project registered' : 'Project updated',
        ),
      );
      setRegisterTarget(null);
      await refresh();
    }
  };

  const openEdit = (project: ConfigProjectRow) => {
    setEditing(project);
    setEditName(project.name);
    setEditDescription(project.description ?? '');
    setEditTags(project.tags);
    setEditGroups(project.groups);
  };

  const submitEdit = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const ok = await updateProject({
        id: editing.id,
        name: editName.trim(),
        description: editDescription,
        tags: editTags,
        groups: editGroups,
      });
      if (ok) {
        message.success(i18nT('项目元数据已保存', 'Project metadata saved'));
        setEditing(null);
        await refresh();
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Space direction='vertical' size={16} style={{ width: '100%' }}>
      <Card
        size='small'
        title={i18nT('当前工作区', 'Current workspace')}
        extra={
          <Button size='small' icon={<ReloadOutlined />} onClick={() => void refresh()}>
            {i18nT('刷新', 'Refresh')}
          </Button>
        }>
        {state.workspace.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={i18nT('当前没有打开工作区文件夹', 'No workspace folder is open')}
          />
        ) : (
          <Space direction='vertical' size={10} style={{ width: '100%' }}>
            {state.workspace.map((workspace) => (
              <Card key={workspace.folder} size='small' type='inner'>
                <Space direction='vertical' size={8} style={{ width: '100%' }}>
                  <Space wrap style={{ justifyContent: 'space-between', width: '100%' }}>
                    <Space wrap>
                      <Typography.Text strong>{workspace.name}</Typography.Text>
                      <Tag>
                        {i18nT(
                          `${workspace.projects.length} 个项目`,
                          `${workspace.projects.length} project(s)`,
                        )}
                      </Tag>
                    </Space>
                    <Typography.Text
                      type='secondary'
                      style={{ fontSize: 12 }}
                      copyable={{ text: workspace.folder }}>
                      {workspace.folder}
                    </Typography.Text>
                  </Space>
                  {workspace.projects.length === 0 ? (
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description={i18nT('未检测到项目', 'No project detected')}
                    />
                  ) : (
                    workspace.projects.map((project) => (
                      <Card
                        key={`${workspace.folder}:${project.path}`}
                        size='small'
                        type='inner'
                        styles={{ body: { padding: 10 } }}>
                        <Space direction='vertical' size={6} style={{ width: '100%' }}>
                          <Space wrap style={{ justifyContent: 'space-between', width: '100%' }}>
                            <Space wrap>
                              <Typography.Text strong>{project.name}</Typography.Text>
                              <Tag color={stateColor[project.state]}>
                                {stateText(project.state)}
                              </Tag>
                              {project.active && (
                                <Tag color='green' icon={<CheckOutlined />}>
                                  {i18nT('当前', 'Current')}
                                </Tag>
                              )}
                              {!project.isRoot && (
                                <Tag color='blue'>{i18nT('嵌套项目', 'Nested')}</Tag>
                              )}
                            </Space>
                            <Space wrap>
                              {!project.projectId ? (
                                <Button
                                  type='primary'
                                  size='small'
                                  icon={<PlusOutlined />}
                                  onClick={() => openRegister(project)}>
                                  {project.anchorRoot
                                    ? i18nT('使用锚点注册', 'Register with anchor')
                                    : project.state === 'unregistered-no-anchor'
                                      ? i18nT('创建锚点并注册', 'Create anchor & register')
                                      : i18nT('注册此项目', 'Register this project')}
                                </Button>
                              ) : (
                                <>
                                  <Button
                                    size='small'
                                    icon={<FolderOpenOutlined />}
                                    onClick={() => openPath(project.path)}>
                                    {i18nT('打开目录', 'Open folder')}
                                  </Button>
                                  <Button
                                    size='small'
                                    icon={<SettingOutlined />}
                                    onClick={() => {
                                      const row = state.projects.find(
                                        (item) =>
                                          item.id === project.projectId ||
                                          item.ids.includes(project.projectId ?? ''),
                                      );
                                      if (row) openEdit(row);
                                    }}>
                                    {i18nT('编辑元数据', 'Edit metadata')}
                                  </Button>
                                  {!project.active && (
                                    <Button
                                      size='small'
                                      icon={<CheckOutlined />}
                                      onClick={() => {
                                        void switchProject(project.folder, project.path).then(() =>
                                          message.success(
                                            i18nT(
                                              `已切换活动项目：${project.name}`,
                                              `Active project: ${project.name}`,
                                            ),
                                          ),
                                        );
                                      }}>
                                      {i18nT('设为当前', 'Set active')}
                                    </Button>
                                  )}
                                </>
                              )}
                            </Space>
                          </Space>
                          <Typography.Text
                            type='secondary'
                            style={{ fontSize: 12 }}
                            copyable={{ text: project.path }}>
                            {project.path}
                          </Typography.Text>
                          <Space wrap size={12}>
                            <Typography.Text type='secondary' style={{ fontSize: 12 }}>
                              Git: {project.gitRoot ?? '—'}
                            </Typography.Text>
                            <Typography.Text type='secondary' style={{ fontSize: 12 }}>
                              lattice.json: {project.anchorRoot ?? '—'}
                            </Typography.Text>
                            {project.projectId && (
                              <Typography.Text
                                type='secondary'
                                style={{ fontSize: 12 }}
                                copyable={{ text: project.projectId }}>
                                {project.projectId}
                              </Typography.Text>
                            )}
                          </Space>
                        </Space>
                      </Card>
                    ))
                  )}
                </Space>
              </Card>
            ))}
          </Space>
        )}
      </Card>

      <Card
        size='small'
        title={i18nT('扫描与注册', 'Scan & registration')}
        extra={
          <Space size={4}>
            <Button
              size='small'
              icon={<ScanOutlined />}
              disabled={state.workspace.length === 0}
              onClick={() => setDirs(state.workspace.map((workspace) => workspace.folder))}>
              {i18nT('当前工作区', 'Current workspace')}
            </Button>
            <Button
              size='small'
              icon={<FolderOpenOutlined />}
              onClick={() => {
                void pickDirectories().then((paths) => {
                  setDirs((current) => [...new Set([...current, ...paths])]);
                });
              }}>
              {i18nT('添加目录', 'Add directories')}
            </Button>
          </Space>
        }>
        <Space direction='vertical' size={10} style={{ width: '100%' }}>
          <Select
            mode='tags'
            value={dirs}
            tokenSeparators={[',', '\n']}
            style={{ width: '100%' }}
            placeholder={i18nT('选择或输入扫描目录', 'Pick or type scan directories')}
            onChange={(next) => setDirs(next)}
          />
          <Space wrap>
            <Checkbox
              checked={saveAsDefault}
              onChange={(event) => setSaveAsDefault(event.target.checked)}>
              {i18nT('保存为默认扫描目录', 'Save as default scan directories')}
            </Checkbox>
            <Button
              type='primary'
              icon={<ScanOutlined />}
              loading={scanning}
              disabled={dirs.length === 0}
              onClick={() => {
                void scan({ dirs, saveAsDefault }).then((result) => {
                  if (result?.canceled) {
                    message.info(i18nT('扫描已取消', 'Scan canceled'));
                  } else if (result) {
                    message.success(
                      i18nT(
                        `扫描完成：新增 ${result.added.length}，更新 ${result.updated.length}`,
                        `Scan complete: ${result.added.length} added, ${result.updated.length} updated`,
                      ),
                    );
                    void refresh();
                  }
                });
              }}>
              {i18nT('开始扫描', 'Start scan')}
            </Button>
            {scanning && (
              <Button onClick={() => void cancelScan()}>{i18nT('取消', 'Cancel')}</Button>
            )}
          </Space>
          {scanning && (
            <Space direction='vertical' size={4} style={{ width: '100%' }}>
              <Progress
                percent={
                  scanProgress?.total
                    ? Math.round(((scanProgress.current ?? 0) / scanProgress.total) * 100)
                    : undefined
                }
                status='active'
              />
              <Typography.Text type='secondary' style={{ fontSize: 12 }}>
                {scanProgress?.currentDir ?? i18nT('正在扫描…', 'Scanning…')}
                {scanProgress &&
                  ` · ${i18nT('发现', 'found')} ${scanProgress.found ?? 0} · +${scanProgress.added ?? 0} ~${scanProgress.updated ?? 0}`}
              </Typography.Text>
            </Space>
          )}
        </Space>
      </Card>

      <Card
        size='small'
        title={i18nT('已注册项目', 'Registered projects')}
        extra={
          <Input.Search
            allowClear
            size='small'
            style={{ width: 280 }}
            placeholder={i18nT('搜索名称 / ID / 路径', 'Search name / ID / path')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        }>
        <Table<ConfigProjectRow>
          rowKey='id'
          size='small'
          dataSource={filtered}
          scroll={{ x: 'max-content' }}
          locale={{ emptyText: i18nT('暂无项目', 'No projects') }}
          pagination={{ pageSize: 20, showSizeChanger: true, pageSizeOptions: [20, 50, 100] }}
          columns={[
            {
              title: i18nT('名称', 'Name'),
              dataIndex: 'name',
              render: (value: string, record) => (
                <Space direction='vertical' size={0}>
                  <Typography.Text strong>{value}</Typography.Text>
                  <Typography.Text
                    type='secondary'
                    style={{ fontSize: 11 }}
                    copyable={{ text: record.id }}>
                    {record.id}
                  </Typography.Text>
                </Space>
              ),
            },
            {
              title: i18nT('路径', 'Path'),
              dataIndex: 'localPaths',
              render: (value: string[]) => (
                <Typography.Text
                  type='secondary'
                  style={{ fontSize: 12 }}
                  ellipsis={{ tooltip: value.join('\n') }}>
                  {value[0] ?? '—'}
                </Typography.Text>
              ),
            },
            {
              title: i18nT('分组 / 标签', 'Groups / tags'),
              render: (_value, record) => (
                <Space wrap size={4}>
                  {record.groups.map((group) => (
                    <Tag key={`g-${group}`}>{group}</Tag>
                  ))}
                  {record.tags.map((tag) => (
                    <Tag key={`t-${tag}`} color='blue'>
                      {tag}
                    </Tag>
                  ))}
                </Space>
              ),
            },
            {
              title: i18nT('操作', 'Actions'),
              width: 210,
              render: (_value, record) => (
                <Space wrap size={4}>
                  <Button
                    size='small'
                    type='link'
                    onClick={() => openPath(record.localPaths[0] ?? '')}>
                    {i18nT('打开', 'Open')}
                  </Button>
                  <Button size='small' type='link' onClick={() => openGraph(record.id)}>
                    {i18nT('图谱', 'Graph')}
                  </Button>
                  <Button size='small' type='link' onClick={() => openEdit(record)}>
                    {i18nT('编辑', 'Edit')}
                  </Button>
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        open={Boolean(registerTarget)}
        title={i18nT('注册当前项目', 'Register current project')}
        onCancel={() => setRegisterTarget(null)}
        onOk={() => void submitRegister()}
        okText={i18nT('注册', 'Register')}
        cancelText={i18nT('取消', 'Cancel')}
        confirmLoading={busy === 'register'}>
        {registerTarget && (
          <Space direction='vertical' size={12} style={{ width: '100%' }}>
            <Alert
              type='info'
              showIcon
              message={registerTarget.name}
              description={
                <Space direction='vertical' size={2}>
                  <Typography.Text>{registerTarget.path}</Typography.Text>
                  <Typography.Text type='secondary'>
                    {registerTarget.anchorRoot
                      ? i18nT(
                          '将使用已有 lattice.json 锚点注册。',
                          'Registers with the existing lattice.json anchor.',
                        )
                      : registerTarget.gitRoot
                        ? i18nT(
                            '将使用 Git 指纹注册；默认不写 lattice.json。',
                            'Registers with the Git fingerprint; lattice.json is not written by default.',
                          )
                        : i18nT(
                            '该目录不是 Git 仓库，需要创建 lattice.json 锚点。',
                            'This directory is not a Git repository; an anchor file is required.',
                          )}
                  </Typography.Text>
                </Space>
              }
            />
            {!registerTarget.anchorRoot && registerTarget.gitRoot && (
              <>
                {registerTarget.path !== registerTarget.gitRoot && (
                  <Radio.Group
                    value={registerFolder ? 'folder' : 'git-root'}
                    onChange={(event) => setRegisterFolder(event.target.value === 'folder')}>
                    <Space direction='vertical'>
                      <Radio value='folder'>
                        {i18nT('只注册当前项目目录', 'Register this project root only')} (
                        {registerTarget.path})
                      </Radio>
                      <Radio value='git-root'>
                        {i18nT('注册 Git 根项目', 'Register the Git root project')} (
                        {registerTarget.gitRoot})
                      </Radio>
                    </Space>
                  </Radio.Group>
                )}
                <Checkbox
                  checked={registerAnchor}
                  onChange={(event) => setRegisterAnchor(event.target.checked)}>
                  {i18nT(
                    '同时创建 lattice.json（可能创建独立的锚点项目）',
                    'Also create lattice.json (may create a separate anchor-bound project)',
                  )}
                </Checkbox>
                {registerTarget.path !== registerTarget.gitRoot && !registerAnchor && (
                  <Alert
                    type='warning'
                    showIcon
                    message={
                      registerFolder
                        ? i18nT(
                            '当前目录与 Git 根不同；不创建锚点会归到同一个 Git 项目。',
                            'This folder differs from the Git root; without an anchor it maps to the same Git project.',
                          )
                        : i18nT(
                            '将注册 Git 根项目，而不是当前嵌套目录。',
                            'The Git root project will be registered instead of this nested folder.',
                          )
                    }
                  />
                )}
              </>
            )}
          </Space>
        )}
      </Modal>

      <Modal
        open={Boolean(editing)}
        title={i18nT('编辑项目元数据', 'Edit project metadata')}
        onCancel={() => setEditing(null)}
        onOk={() => void submitEdit()}
        confirmLoading={saving}
        okButtonProps={{ disabled: !editName.trim() }}
        okText={i18nT('保存', 'Save')}
        cancelText={i18nT('取消', 'Cancel')}>
        <Space direction='vertical' size={12} style={{ width: '100%' }}>
          <div>
            <Typography.Text>{i18nT('名称', 'Name')}</Typography.Text>
            <Input value={editName} onChange={(event) => setEditName(event.target.value)} />
          </div>
          <div>
            <Typography.Text>{i18nT('描述', 'Description')}</Typography.Text>
            <Input.TextArea
              value={editDescription}
              rows={3}
              onChange={(event) => setEditDescription(event.target.value)}
            />
          </div>
          <div>
            <Typography.Text>{i18nT('标签', 'Tags')}</Typography.Text>
            <Select
              mode='tags'
              value={editTags}
              style={{ width: '100%' }}
              onChange={(next) => setEditTags(next)}
            />
          </div>
          <div>
            <Typography.Text>{i18nT('分组', 'Groups')}</Typography.Text>
            <Select
              mode='multiple'
              value={editGroups}
              style={{ width: '100%' }}
              options={state.groupPaths.map((path) => ({ value: path, label: path }))}
              placeholder={i18nT('选择分组路径', 'Select group paths')}
              onChange={(next) => setEditGroups(next)}
            />
          </div>
        </Space>
      </Modal>
    </Space>
  );
}
