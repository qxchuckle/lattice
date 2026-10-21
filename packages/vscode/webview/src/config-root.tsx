import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, App, Button, Input, Space, Spin, Tag, Typography } from 'antd';
import {
  AppstoreOutlined,
  CloudSyncOutlined,
  CodeOutlined,
  DatabaseOutlined,
  FolderOutlined,
  SearchOutlined,
  SettingOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import { i18nT } from '@lattice-web-ui';
import type {
  ConfigGitOperation,
  ConfigOperationKind,
  ConfigProgressEvent,
  ConfigRegisterPayload,
  ConfigRegisterResult,
  ConfigRagPayload,
  ConfigSaveResult,
  ConfigScanPayload,
  ConfigScanResult,
  ConfigSectionId,
  ConfigSettingsTarget,
  ConfigStatePayload,
  ConfigSyncOperation,
  ConfigUpdateProjectPayload,
  ConfigUserOperation,
} from '@qcqx/lattice-protocol';
import {
  cancelScan,
  clearConfigDraft,
  copyDiagnostics,
  getConfigDraft,
  getConfigState,
  gitOperation,
  onConfigProgress,
  onConfigRoute,
  onConfigStateChanged,
  openConfigFile,
  openVscodeSettings,
  pickDirectory,
  registerProject,
  runDoctor,
  runRag,
  runScan,
  saveConfig,
  saveConfigDraft,
  syncOperation,
  updateProject,
  userOperation,
} from './config/client';
import {
  ConfigContext,
  emptyDraft,
  type ConfigContextValue,
  type DraftState,
  type DraftStore,
} from './config/context';
import { readPath, sameConfigValue } from './config/paths';
import { OverviewSection } from './config/sections/overview';
import { ProjectsSection } from './config/sections/projects';
import { SettingsSection } from './config/sections/settings';
import { CoreSection } from './config/sections/core';
import { UsersSyncSection } from './config/sections/users-sync';
import { DiagnosticsSection } from './config/sections/diagnostics';
import { AdvancedSection } from './config/sections/advanced';
import { bridgeAction } from './host';

const NAV: Array<{
  id: ConfigSectionId;
  label: { zh: string; en: string };
  icon: ReactNode;
}> = [
  { id: 'overview', label: { zh: '概览', en: 'Overview' }, icon: <AppstoreOutlined /> },
  {
    id: 'projects',
    label: { zh: '项目与注册', en: 'Projects & registration' },
    icon: <FolderOutlined />,
  },
  { id: 'editor', label: { zh: '编辑器设置', en: 'Editor settings' }, icon: <SettingOutlined /> },
  { id: 'core', label: { zh: 'Lattice 配置', en: 'Lattice config' }, icon: <DatabaseOutlined /> },
  { id: 'users', label: { zh: '用户与同步', en: 'Users & sync' }, icon: <CloudSyncOutlined /> },
  { id: 'diagnostics', label: { zh: '诊断', en: 'Diagnostics' }, icon: <ToolOutlined /> },
  { id: 'advanced', label: { zh: '高级', en: 'Advanced' }, icon: <CodeOutlined /> },
];

function baselineOf(state: ConfigStatePayload, store: DraftStore): Record<string, unknown> {
  if (store === 'vscode') return state.settings.values;
  if (store === 'global') return state.core.global;
  return state.core.local;
}

/** Values shown in the form; global embedding fields may inherit defaults/local overrides. */
function displayBaselineOf(state: ConfigStatePayload, store: DraftStore): Record<string, unknown> {
  if (store === 'global') return state.core.globalEffective ?? state.core.global;
  if (store === 'local') return { ...state.core.localDefaults, ...state.core.local };
  return baselineOf(state, store);
}

function hasDraftChanges(draft: DraftState): boolean {
  return (
    Object.keys(draft.vscode).length > 0 ||
    Object.keys(draft.global).length > 0 ||
    Object.keys(draft.local).length > 0 ||
    draft.unsetVscode.length > 0 ||
    draft.unsetGlobal.length > 0 ||
    draft.unsetLocal.length > 0
  );
}

function normalizeDraft(value: unknown): DraftState | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Partial<DraftState>;
  const asRecord = (input: unknown): Record<string, unknown> =>
    input && typeof input === 'object' && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  const asArray = (input: unknown): string[] =>
    Array.isArray(input) ? input.filter((item): item is string => typeof item === 'string') : [];
  return {
    vscode: asRecord(source.vscode),
    global: asRecord(source.global),
    local: asRecord(source.local),
    unsetVscode: asArray(source.unsetVscode),
    unsetGlobal: asArray(source.unsetGlobal),
    unsetLocal: asArray(source.unsetLocal),
  };
}

export function ConfigRoot() {
  const { message, modal } = App.useApp();
  const [state, setState] = useState<ConfigStatePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftState>(emptyDraft);
  const [section, setSection] = useState<ConfigSectionId>('overview');
  const [search, setSearch] = useState('');
  const [settingsTarget, setSettingsTarget] = useState<ConfigSettingsTarget>('workspace');
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<ConfigProgressEvent | null>(null);
  const [scanProgress, setScanProgress] = useState<ConfigProgressEvent | null>(null);
  const [ragProgress, setRagProgress] = useState<ConfigProgressEvent | null>(null);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const targetInitialized = useRef(false);
  const draftChecked = useRef(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const next = await getConfigState();
      setState(next);
      if (!targetInitialized.current) {
        targetInitialized.current = true;
        setSettingsTarget(next.settings.target);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 面板隐藏/关闭后恢复草稿（workspaceState 持久化；只在首次拿到状态后询问一次）。
  useEffect(() => {
    if (!state || draftChecked.current) return;
    draftChecked.current = true;
    void getConfigDraft()
      .then((snapshot) => {
        if (!snapshot) {
          setDraftLoaded(true);
          return;
        }
        const restored = normalizeDraft(snapshot.draft);
        if (!restored || !hasDraftChanges(restored)) {
          void clearConfigDraft();
          setDraftLoaded(true);
          return;
        }
        modal.confirm({
          title: i18nT('发现未保存的配置草稿', 'Unsaved configuration draft found'),
          content: i18nT(
            '上次关闭配置中心时有未保存的修改。恢复草稿？',
            'The Configuration Center was closed with unsaved changes. Restore the draft?',
          ),
          okText: i18nT('恢复', 'Restore'),
          cancelText: i18nT('丢弃', 'Discard'),
          onOk: () => {
            setDraft(restored);
            setSettingsTarget(snapshot.settingsTarget);
            setDraftLoaded(true);
            message.info(i18nT('已恢复草稿', 'Draft restored'));
          },
          onCancel: () => {
            void clearConfigDraft();
            setDraftLoaded(true);
          },
        });
      })
      .catch(() => {
        /* 草稿恢复不是关键路径 */
        setDraftLoaded(true);
      });
  }, [message, modal, state]);

  useEffect(() => {
    const offRoute = onConfigRoute((path) => {
      const clean = path.replace(/^\//, '').split('#')[0];
      if (NAV.some((item) => item.id === clean)) setSection(clean as ConfigSectionId);
    });
    const offProgress = onConfigProgress((event) => {
      setProgress(event);
      if (event.kind === 'scan') setScanProgress(event);
      if (event.kind === 'rag') setRagProgress(event);
    });
    const offState = onConfigStateChanged(() => {
      void load(true);
    });
    return () => {
      offRoute();
      offProgress();
      offState();
    };
  }, [load]);

  const setField = useCallback((store: DraftStore, key: string, value: unknown) => {
    setDraft((current) => {
      const unsetKey =
        store === 'vscode' ? 'unsetVscode' : store === 'global' ? 'unsetGlobal' : 'unsetLocal';
      return {
        ...current,
        [store]: { ...current[store], [key]: value },
        [unsetKey]: current[unsetKey].filter((item) => item !== key),
      };
    });
  }, []);

  const resetField = useCallback((store: DraftStore, key: string) => {
    setDraft((current) => {
      const values = { ...current[store] };
      delete values[key];
      const unsetKey =
        store === 'vscode' ? 'unsetVscode' : store === 'global' ? 'unsetGlobal' : 'unsetLocal';
      return {
        ...current,
        [store]: values,
        [unsetKey]: [...new Set([...current[unsetKey], key])],
      };
    });
  }, []);

  const clearField = useCallback((store: DraftStore, key: string) => {
    setDraft((current) => {
      const values = { ...current[store] };
      delete values[key];
      const unsetKey =
        store === 'vscode' ? 'unsetVscode' : store === 'global' ? 'unsetGlobal' : 'unsetLocal';
      return {
        ...current,
        [store]: values,
        [unsetKey]: current[unsetKey].filter((item) => item !== key),
      };
    });
  }, []);

  const dirtyCount = useMemo(() => {
    if (!state) return 0;
    let count = 0;
    const stores: DraftStore[] = ['vscode', 'global', 'local'];
    for (const store of stores) {
      const baseline = baselineOf(state, store);
      const displayBaseline = displayBaselineOf(state, store);
      const baselineAt = (key: string): unknown =>
        store === 'global' ? readPath(baseline, key) : baseline[key];
      const displayAt = (key: string): unknown =>
        store === 'global' ? readPath(displayBaseline, key) : displayBaseline[key];
      for (const [key, value] of Object.entries(draft[store])) {
        if (!sameConfigValue(value, displayAt(key))) count += 1;
      }
      const unsetKey =
        store === 'vscode' ? 'unsetVscode' : store === 'global' ? 'unsetGlobal' : 'unsetLocal';
      for (const key of draft[unsetKey]) {
        if (store === 'vscode') {
          if (state.settings.sources[key] !== 'default') count += 1;
        } else if (baselineAt(key) !== undefined) {
          count += 1;
        }
      }
    }
    return count;
  }, [draft, state]);

  // 草稿持久化：dirty 时防抖写入 workspaceState；归零/保存/放弃时清理。
  useEffect(() => {
    if (!draftLoaded || !state) return;
    if (dirtyCount === 0) {
      // 用户把修改全部撤回（或已保存/放弃）后不要留下过期草稿。
      void clearConfigDraft();
      return;
    }
    const timer = setTimeout(() => {
      void saveConfigDraft({ draft, settingsTarget }).catch(() => {
        /* 草稿持久化失败不应打断编辑 */
      });
    }, 600);
    return () => clearTimeout(timer);
  }, [draft, draftLoaded, dirtyCount, settingsTarget, state]);

  const refresh = useCallback(async () => {
    setBusy('refresh');
    try {
      await load(true);
    } finally {
      setBusy(null);
    }
  }, [load]);

  const doSave = useCallback(async (): Promise<ConfigSaveResult | undefined> => {
    if (!state) return undefined;
    setBusy('save');
    try {
      const hasVscode = Object.keys(draft.vscode).length > 0 || draft.unsetVscode.length > 0;
      const hasGlobal = Object.keys(draft.global).length > 0 || draft.unsetGlobal.length > 0;
      const hasLocal = Object.keys(draft.local).length > 0 || draft.unsetLocal.length > 0;
      const result = await saveConfig({
        ...(hasVscode
          ? {
              vscode: {
                target: settingsTarget,
                set: draft.vscode,
                unset: draft.unsetVscode,
              },
            }
          : {}),
        ...(hasGlobal ? { global: { set: draft.global, unset: draft.unsetGlobal } } : {}),
        ...(hasLocal ? { local: { set: draft.local, unset: draft.unsetLocal } } : {}),
      });
      setDraft(emptyDraft());
      void clearConfigDraft();
      message.success(
        i18nT(
          `已保存 ${result.changedKeys.length} 项配置`,
          `Saved ${result.changedKeys.length} setting(s)`,
        ),
      );
      for (const warning of result.warnings) {
        message.warning(warning);
      }
      await load(true);

      if (result.requiresReload) {
        modal.confirm({
          title: i18nT('需要重新加载窗口', 'Reload window required'),
          content: i18nT(
            '数据根已变更，重新加载窗口后生效。',
            'The data root changed. Reload the window to apply it.',
          ),
          okText: i18nT('重新加载', 'Reload'),
          cancelText: i18nT('稍后', 'Later'),
          onOk: () => bridgeAction('executeCommand', { command: 'workbench.action.reloadWindow' }),
        });
      } else if (result.requiresRagRebuild) {
        modal.confirm({
          title: i18nT('需要重建索引', 'Rebuild index required'),
          content: i18nT(
            '模型或索引参数已变更，建议立即重建 RAG 索引。',
            'The model or index parameters changed. Rebuild the RAG index now?',
          ),
          okText: i18nT('重建索引', 'Rebuild'),
          cancelText: i18nT('稍后', 'Later'),
          onOk: async () => {
            await runRagAction({ action: 'rebuild' });
          },
        });
      }
      return result;
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
      return undefined;
    } finally {
      setBusy(null);
    }
  }, [draft, load, message, modal, settingsTarget, state]);

  const scan = useCallback(
    async (payload: ConfigScanPayload): Promise<ConfigScanResult | undefined> => {
      setBusy('scan');
      setScanProgress({ kind: 'scan', phase: 'start' });
      try {
        return await runScan(payload);
      } catch (err) {
        message.error(err instanceof Error ? err.message : String(err));
        return undefined;
      } finally {
        setBusy(null);
        setTimeout(() => setScanProgress(null), 1500);
      }
    },
    [message],
  );

  const doCancelScan = useCallback(async () => {
    await cancelScan();
    setScanProgress((current) => (current ? { ...current, phase: 'canceled' } : current));
  }, []);

  const register = useCallback(
    async (payload: ConfigRegisterPayload): Promise<ConfigRegisterResult | undefined> => {
      setBusy('register');
      try {
        return await registerProject(payload);
      } catch (err) {
        message.error(err instanceof Error ? err.message : String(err));
        return undefined;
      } finally {
        setBusy(null);
      }
    },
    [message],
  );

  const update = useCallback(
    async (payload: ConfigUpdateProjectPayload): Promise<boolean> => {
      setBusy('project');
      try {
        await updateProject(payload);
        return true;
      } catch (err) {
        message.error(err instanceof Error ? err.message : String(err));
        return false;
      } finally {
        setBusy(null);
      }
    },
    [message],
  );

  const runDoctorAction = useCallback(
    async (fix = false) => {
      setBusy('doctor');
      try {
        return await runDoctor({ fix });
      } catch (err) {
        message.error(err instanceof Error ? err.message : String(err));
        return undefined;
      } finally {
        setBusy(null);
      }
    },
    [message],
  );

  const runRagAction = useCallback(
    async (payload: ConfigRagPayload) => {
      setBusy(payload.action === 'rebuild' ? 'rag-rebuild' : 'rag-update');
      setRagProgress({ kind: 'rag', phase: 'start' });
      try {
        const count = await runRag(payload);
        message.success(i18nT(`已索引 ${count} 个文档`, `Indexed ${count} document(s)`));
        await load(true);
        return count;
      } catch (err) {
        message.error(err instanceof Error ? err.message : String(err));
        return undefined;
      } finally {
        setBusy(null);
        setTimeout(() => setRagProgress(null), 2000);
      }
    },
    [load, message],
  );

  const gitOp = useCallback(async (payload: ConfigGitOperation) => {
    setBusy('git');
    try {
      return await gitOperation(payload);
    } finally {
      setBusy(null);
    }
  }, []);

  const syncOp = useCallback(async (payload: ConfigSyncOperation) => {
    setBusy('sync');
    try {
      return await syncOperation(payload);
    } finally {
      setBusy(null);
    }
  }, []);

  const userOp = useCallback(async (payload: ConfigUserOperation) => {
    setBusy('user');
    try {
      await userOperation(payload);
    } finally {
      setBusy(null);
    }
  }, []);

  const pickDirectories = useCallback(async () => {
    const result = await pickDirectory();
    return result.paths;
  }, []);

  const copyDiag = useCallback(async () => {
    try {
      await copyDiagnostics();
      message.success(i18nT('诊断信息已复制', 'Diagnostics copied to clipboard'));
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    }
  }, [message]);

  const openConfig = useCallback(async (scope: 'global' | 'local') => {
    await openConfigFile(scope);
  }, []);

  const openSettings = useCallback(async (key?: string) => {
    await openVscodeSettings(key);
  }, []);

  const openPath = useCallback((path: string) => {
    if (!path) return;
    bridgeAction('openPathByPath', { path });
  }, []);

  const openGraph = useCallback((projectId: string) => {
    bridgeAction('executeCommand', {
      command: 'lattice.project.revealInGraph',
      args: [{ projectId }],
    });
  }, []);

  const switchProject = useCallback(
    async (folder: string, rootPath: string) => {
      await bridgeAction('executeCommand', {
        command: 'lattice.project.switchActive',
        args: [{ folderPath: folder, rootPath }],
      });
      await load(true);
    },
    [load],
  );

  if (loading && !state) {
    return (
      <div style={{ height: '100vh', display: 'grid', placeItems: 'center' }}>
        <Spin size='large' tip={i18nT('正在读取 Lattice 配置…', 'Loading Lattice configuration…')}>
          <div style={{ width: 220, height: 80 }} />
        </Spin>
      </div>
    );
  }

  if (!state) {
    return (
      <div style={{ padding: 24 }}>
        <Alert
          type='error'
          showIcon
          message={i18nT('配置中心加载失败', 'Failed to load configuration center')}
          description={error}
          action={
            <Button size='small' onClick={() => void load()}>
              {i18nT('重试', 'Retry')}
            </Button>
          }
        />
      </div>
    );
  }

  const context: ConfigContextValue = {
    state,
    loading,
    error,
    draft,
    dirtyCount,
    search,
    setSearch,
    settingsTarget,
    setSettingsTarget,
    section,
    navigate: (next, _anchor) => setSection(next),
    setField,
    resetField,
    clearField,
    save: doSave,
    refresh,
    busy,
    progress,
    scanProgress,
    ragProgress,
    scan,
    cancelScan: doCancelScan,
    registerProject: register,
    updateProject: update,
    runDoctor: runDoctorAction,
    runRag: runRagAction,
    gitOp,
    syncOp,
    userOp,
    pickDirectories,
    copyDiagnostics: copyDiag,
    openConfigFile: openConfig,
    openSettings,
    openPath,
    openGraph,
    switchProject,
    domains: state.domains,
  };

  return (
    <ConfigContext.Provider value={context}>
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
        <header
          style={{
            padding: '14px 20px',
            borderBottom: '1px solid var(--border)',
            background: 'var(--bg-secondary)',
          }}>
          <Space wrap style={{ justifyContent: 'space-between', width: '100%' }}>
            <Space direction='vertical' size={2}>
              <Space wrap>
                <Typography.Title level={4} style={{ margin: 0 }}>
                  {i18nT('Lattice 配置中心', 'Lattice Configuration Center')}
                </Typography.Title>
                <Tag color={state.initialized ? 'green' : 'orange'}>
                  {state.initialized
                    ? i18nT('已初始化', 'Initialized')
                    : i18nT('未初始化', 'Not initialized')}
                </Tag>
              </Space>
              <Space wrap size={8}>
                <Typography.Text type='secondary' style={{ fontSize: 12 }}>
                  {i18nT('用户', 'User')}: {state.user || '—'}
                </Typography.Text>
                <Typography.Text
                  type='secondary'
                  style={{ fontSize: 12 }}
                  copyable={{ text: state.runtime.root }}>
                  {state.runtime.root}
                </Typography.Text>
              </Space>
            </Space>
            {(section === 'editor' || section === 'core') && (
              <Input
                allowClear
                prefix={<SearchOutlined />}
                style={{ width: 320 }}
                placeholder={i18nT('搜索配置项…', 'Search settings…')}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            )}
          </Space>
        </header>

        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          <nav
            style={{
              width: 220,
              flex: '0 0 220px',
              borderRight: '1px solid var(--border)',
              background: 'var(--bg-secondary)',
              padding: 10,
              overflow: 'auto',
            }}>
            <Space direction='vertical' size={4} style={{ width: '100%' }}>
              {NAV.map((item) => (
                <Button
                  key={item.id}
                  type={section === item.id ? 'primary' : 'text'}
                  icon={item.icon}
                  style={{ justifyContent: 'flex-start', width: '100%' }}
                  onClick={() => setSection(item.id)}>
                  {i18nT(item.label.zh, item.label.en)}
                </Button>
              ))}
            </Space>
          </nav>

          <main style={{ flex: 1, minWidth: 0, overflow: 'auto', padding: 20 }}>
            <div style={{ maxWidth: 1080, margin: '0 auto' }}>
              {section === 'overview' && <OverviewSection />}
              {section === 'projects' && <ProjectsSection />}
              {section === 'editor' && <SettingsSection />}
              {section === 'core' && <CoreSection />}
              {section === 'users' && <UsersSyncSection />}
              {section === 'diagnostics' && <DiagnosticsSection />}
              {section === 'advanced' && <AdvancedSection />}
            </div>
          </main>
        </div>

        {dirtyCount > 0 && (
          <footer
            style={{
              borderTop: '1px solid var(--border)',
              background: 'var(--bg-secondary)',
              padding: '10px 20px',
            }}>
            <Space wrap style={{ justifyContent: 'space-between', width: '100%' }}>
              <Typography.Text>
                {i18nT(`${dirtyCount} 项未保存`, `${dirtyCount} unsaved change(s)`)}
              </Typography.Text>
              <Space>
                <Button
                  onClick={() => {
                    setDraft(emptyDraft());
                    void clearConfigDraft();
                  }}>
                  {i18nT('放弃', 'Discard')}
                </Button>
                <Button type='primary' loading={busy === 'save'} onClick={() => void doSave()}>
                  {i18nT('保存更改', 'Save changes')}
                </Button>
              </Space>
            </Space>
          </footer>
        )}
      </div>
    </ConfigContext.Provider>
  );
}
