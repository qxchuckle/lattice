import type {
  ConfigDoctorPayload,
  ConfigDraftSnapshot,
  ConfigGitOperation,
  ConfigOperationKind,
  ConfigProgressEvent,
  ConfigRagPayload,
  ConfigRegisterPayload,
  ConfigRegisterResult,
  ConfigSavePayload,
  ConfigSaveResult,
  ConfigScanPayload,
  ConfigScanResult,
  ConfigStatePayload,
  ConfigSyncOperation,
  ConfigUpdateProjectPayload,
  ConfigUserOperation,
} from '@qcqx/lattice-protocol';
import { bridgeRequest } from '../host';

const STATE_TIMEOUT = 120_000;
const LONG_TIMEOUT = 30 * 60_000;

export function getConfigState(): Promise<ConfigStatePayload> {
  return bridgeRequest<ConfigStatePayload>('getConfigState', undefined, STATE_TIMEOUT);
}

export function saveConfig(payload: ConfigSavePayload): Promise<ConfigSaveResult> {
  return bridgeRequest<ConfigSaveResult>('saveConfig', payload, 60_000);
}

export function runScan(payload: ConfigScanPayload): Promise<ConfigScanResult> {
  return bridgeRequest<ConfigScanResult>('scanProjects', payload, LONG_TIMEOUT);
}

export function cancelScan(): Promise<{ ok: boolean }> {
  return bridgeRequest<{ ok: boolean }>('cancelScan');
}

export function registerProject(payload: ConfigRegisterPayload): Promise<ConfigRegisterResult> {
  return bridgeRequest<ConfigRegisterResult>('registerProject', payload, 60_000);
}

export function updateProject(payload: ConfigUpdateProjectPayload): Promise<{ ok: boolean }> {
  return bridgeRequest<{ ok: boolean }>('updateProject', payload, 60_000);
}

export function runDoctor(payload: ConfigDoctorPayload = {}): Promise<unknown> {
  return bridgeRequest<unknown>('runDoctor', payload, LONG_TIMEOUT);
}

export function runRag(payload: ConfigRagPayload): Promise<number> {
  return bridgeRequest<number>('runRag', payload, LONG_TIMEOUT);
}

export function gitOperation(payload: ConfigGitOperation): Promise<unknown> {
  return bridgeRequest<unknown>('gitOperation', payload, LONG_TIMEOUT);
}

export function syncOperation(payload: ConfigSyncOperation): Promise<unknown> {
  return bridgeRequest<unknown>('syncOperation', payload, LONG_TIMEOUT);
}

export function userOperation(payload: ConfigUserOperation): Promise<{ ok: boolean }> {
  return bridgeRequest<{ ok: boolean }>('userOperation', payload, 60_000);
}

export function pickDirectory(): Promise<{ paths: string[] }> {
  return bridgeRequest<{ paths: string[] }>('pickDirectory');
}

export function copyDiagnostics(): Promise<{ text: string }> {
  return bridgeRequest<{ text: string }>('copyDiagnostics', undefined, 120_000);
}

export function openConfigFile(scope: 'global' | 'local'): Promise<{ ok: boolean }> {
  return bridgeRequest<{ ok: boolean }>('openConfigFile', { scope });
}

export function openVscodeSettings(key?: string): Promise<{ ok: boolean }> {
  return bridgeRequest<{ ok: boolean }>('openVscodeSettings', { key });
}

export function getConfigDraft(): Promise<ConfigDraftSnapshot | null> {
  return bridgeRequest<ConfigDraftSnapshot | null>('getConfigDraft');
}

export function saveConfigDraft(payload: {
  draft: unknown;
  settingsTarget: 'user' | 'workspace';
}): Promise<ConfigDraftSnapshot> {
  return bridgeRequest<ConfigDraftSnapshot>('saveConfigDraft', payload);
}

export function clearConfigDraft(): Promise<{ ok: boolean }> {
  return bridgeRequest<{ ok: boolean }>('clearConfigDraft');
}

export function onConfigProgress(handler: (event: ConfigProgressEvent) => void): () => void {
  const listener = (event: Event) => handler((event as CustomEvent<ConfigProgressEvent>).detail);
  window.addEventListener('lattice:config-progress', listener);
  return () => window.removeEventListener('lattice:config-progress', listener);
}

export function onConfigStateChanged(handler: () => void): () => void {
  const listener = () => handler();
  window.addEventListener('lattice:config-state-changed', listener);
  return () => window.removeEventListener('lattice:config-state-changed', listener);
}

export function onConfigRoute(handler: (path: string) => void): () => void {
  const listener = (event: Event) => handler((event as CustomEvent<string>).detail);
  window.addEventListener('lattice:config-route', listener);
  return () => window.removeEventListener('lattice:config-route', listener);
}

export type { ConfigOperationKind };
