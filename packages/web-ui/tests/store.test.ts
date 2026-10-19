import { beforeEach, expect, it } from 'vitest';
import {
  authStore,
  canvasSearchStore,
  clearToken,
  closeCanvasSearch,
  closeGlobalSearch,
  globalSearchStore,
  loadStoredToken,
  openCanvasSearch,
  openGlobalSearch,
  saveToken,
} from '../src/store';

const TOKEN_KEY = 'lattice-web-auth-token';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  clearToken();
});

it('saveToken(remember=true)：写入 store + localStorage，并清掉 sessionStorage', () => {
  saveToken('tok-local', true);
  expect(authStore.token).toBe('tok-local');
  expect(localStorage.getItem(TOKEN_KEY)).toBe('tok-local');
  expect(sessionStorage.getItem(TOKEN_KEY)).toBeNull();
});

it('saveToken(remember=false)：写入 store + sessionStorage，并清掉 localStorage', () => {
  localStorage.setItem(TOKEN_KEY, 'stale');
  saveToken('tok-session', false);
  expect(authStore.token).toBe('tok-session');
  expect(sessionStorage.getItem(TOKEN_KEY)).toBe('tok-session');
  expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
});

it('clearToken：清空 store 与两处存储', () => {
  saveToken('tok', true);
  clearToken();
  expect(authStore.token).toBeNull();
  expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  expect(sessionStorage.getItem(TOKEN_KEY)).toBeNull();
});

it('loadStoredToken：优先 localStorage', () => {
  localStorage.setItem(TOKEN_KEY, 'from-local');
  sessionStorage.setItem(TOKEN_KEY, 'from-session');
  loadStoredToken();
  expect(authStore.token).toBe('from-local');
});

it('loadStoredToken：localStorage 缺失时回落 sessionStorage', () => {
  sessionStorage.setItem(TOKEN_KEY, 'from-session');
  loadStoredToken();
  expect(authStore.token).toBe('from-session');
});

it('画布搜索开关：open/close 状态与查询态复位', () => {
  expect(canvasSearchStore.open).toBe(false);
  openCanvasSearch();
  expect(canvasSearchStore.open).toBe(true);
  canvasSearchStore.query = 'residual';
  canvasSearchStore.matchIds = ['n1'];
  canvasSearchStore.matchIndex = 0;
  // close → 再 open 应复位上次搜索态
  closeCanvasSearch();
  openCanvasSearch();
  expect(canvasSearchStore.query).toBe('');
  expect(canvasSearchStore.matchIds).toEqual([]);
  expect(canvasSearchStore.matchIndex).toBe(-1);
  closeCanvasSearch();
  expect(canvasSearchStore.open).toBe(false);
});

it('全局搜索面板：open 复位筛选，close 收起', () => {
  globalSearchStore.searchType = 'task';
  openGlobalSearch();
  expect(globalSearchStore.open).toBe(true);
  expect(globalSearchStore.searchType).toBe('all');
  closeGlobalSearch();
  expect(globalSearchStore.open).toBe(false);
});
