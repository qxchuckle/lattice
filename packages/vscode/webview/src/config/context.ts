import { createContext, useContext } from 'react';
import type {
  ConfigDomainInfo,
  ConfigGitOperation,
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

export type DraftStore = 'vscode' | 'global' | 'local';

export interface DraftState {
  vscode: Record<string, unknown>;
  global: Record<string, unknown>;
  local: Record<string, unknown>;
  unsetVscode: string[];
  unsetGlobal: string[];
  unsetLocal: string[];
}

export function emptyDraft(): DraftState {
  return {
    vscode: {},
    global: {},
    local: {},
    unsetVscode: [],
    unsetGlobal: [],
    unsetLocal: [],
  };
}

export interface ConfigContextValue {
  state: ConfigStatePayload;
  loading: boolean;
  error: string | null;
  draft: DraftState;
  dirtyCount: number;
  search: string;
  setSearch: (value: string) => void;
  settingsTarget: ConfigSettingsTarget;
  setSettingsTarget: (target: ConfigSettingsTarget) => void;
  section: ConfigSectionId;
  navigate: (section: ConfigSectionId, anchor?: string) => void;
  setField: (store: DraftStore, key: string, value: unknown) => void;
  resetField: (store: DraftStore, key: string) => void;
  clearField: (store: DraftStore, key: string) => void;
  save: () => Promise<ConfigSaveResult | undefined>;
  refresh: () => Promise<void>;
  busy: string | null;
  progress: ConfigProgressEvent | null;
  scanProgress: ConfigProgressEvent | null;
  ragProgress: ConfigProgressEvent | null;
  scan: (payload: ConfigScanPayload) => Promise<ConfigScanResult | undefined>;
  cancelScan: () => Promise<void>;
  registerProject: (payload: ConfigRegisterPayload) => Promise<ConfigRegisterResult | undefined>;
  updateProject: (payload: ConfigUpdateProjectPayload) => Promise<boolean>;
  runDoctor: (fix?: boolean) => Promise<unknown>;
  runRag: (payload: ConfigRagPayload) => Promise<number | undefined>;
  gitOp: (payload: ConfigGitOperation) => Promise<unknown>;
  syncOp: (payload: ConfigSyncOperation) => Promise<unknown>;
  userOp: (payload: ConfigUserOperation) => Promise<void>;
  pickDirectories: () => Promise<string[]>;
  copyDiagnostics: () => Promise<void>;
  openConfigFile: (scope: 'global' | 'local') => Promise<void>;
  openSettings: (key?: string) => Promise<void>;
  openPath: (path: string) => void;
  openGraph: (projectId: string) => void;
  switchProject: (folder: string, rootPath: string) => Promise<void>;
  domains: ConfigDomainInfo[];
}

export const ConfigContext = createContext<ConfigContextValue | null>(null);

export function useConfig(): ConfigContextValue {
  const value = useContext(ConfigContext);
  if (!value) throw new Error('ConfigContext is not available');
  return value;
}
