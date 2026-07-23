/**
 * useAgentSocket — Agent WebSocket 连接管理
 */
import { useEffect, useRef, useCallback } from 'react';
import type { ConversationTree, ConversationNode, AgentEvent } from '@qcqx/lattice-agent';
import {
  workbenchStore,
  setTreeData,
  setStreaming,
  resetStreaming,
} from './store';
import { authStore } from '../../store';

export function useAgentSocket() {
  const wsRef = useRef<WebSocket | null>(null);

  const connect = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const token = authStore.token ? `?token=${authStore.token}` : '';
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/agent/ws${token}`);
    wsRef.current = ws;

    ws.onopen = () => {
      workbenchStore.wsConnected = true;
    };

    ws.onclose = () => {
      workbenchStore.wsConnected = false;
      // 自动重连（3s 后）
      setTimeout(() => connect(), 3000);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleMessage(msg);
      } catch { /* ignore */ }
    };
  }, []);

  const handleMessage = useCallback((msg: Record<string, unknown>) => {
    switch (msg.type) {
      case 'session.created': {
        workbenchStore.sessionId = msg.sessionId as string;
        workbenchStore.treeId = msg.treeId as string;
        workbenchStore.agentStatus = 'idle';
        // 加载树数据
        loadTree(msg.treeId as string);
        break;
      }
      case 'event': {
        const agentEvent = msg.event as AgentEvent;
        const events = [...workbenchStore.streamingEvents, agentEvent];
        const text = events
          .filter((e) => e.type === 'text')
          .map((e) => (e as { content: string }).content)
          .join('');
        setStreaming(text, events);
        if (agentEvent.type === 'done') {
          workbenchStore.agentStatus = 'idle';
        }
        break;
      }
      case 'tree.updated': {
        if (msg.treeId) loadTree(msg.treeId as string);
        break;
      }
      case 'session.error': {
        workbenchStore.agentStatus = 'error';
        resetStreaming();
        break;
      }
      case 'permission.request': {
        // TODO: 弹出权限确认 UI
        break;
      }
    }
  }, []);

  const loadTree = useCallback(async (treeId: string) => {
    try {
      const headers: Record<string, string> = {};
      if (authStore.token) headers.Authorization = `Bearer ${authStore.token}`;
      const res = await fetch(`/api/agent/tree/${treeId}`, { headers });
      if (!res.ok) return;
      const data = await res.json() as { tree: ConversationTree; nodes: ConversationNode[] };
      setTreeData(data.tree, data.nodes);
    } catch { /* ignore */ }
  }, []);

  // ── 发送方法 ──

  const createSession = useCallback((opts?: { taskId?: string; cwd?: string }) => {
    wsRef.current?.send(JSON.stringify({
      type: 'session.create',
      agentId: 'qoder',
      cwd: opts?.cwd,
      taskId: opts?.taskId,
    }));
    workbenchStore.agentStatus = 'connecting';
  }, []);

  const sendMessage = useCallback((message: string) => {
    if (!wsRef.current || !workbenchStore.sessionId) return;
    workbenchStore.agentStatus = 'running';
    resetStreaming();
    wsRef.current.send(JSON.stringify({
      type: 'session.send',
      sessionId: workbenchStore.sessionId,
      treeId: workbenchStore.treeId,
      message,
    }));
  }, []);

  const fork = useCallback((nodeId: string, branchName?: string) => {
    wsRef.current?.send(JSON.stringify({
      type: 'tree.fork',
      treeId: workbenchStore.treeId,
      nodeId,
      branchName,
    }));
  }, []);

  const deleteNodes = useCallback((nodeIds: string[]) => {
    wsRef.current?.send(JSON.stringify({
      type: 'tree.delete',
      treeId: workbenchStore.treeId,
      nodeIds,
    }));
  }, []);

  const switchHead = useCallback((nodeId: string) => {
    wsRef.current?.send(JSON.stringify({
      type: 'tree.switchHead',
      treeId: workbenchStore.treeId,
      nodeId,
    }));
  }, []);

  useEffect(() => {
    connect();
    return () => { wsRef.current?.close(); };
  }, [connect]);

  return { createSession, sendMessage, fork, deleteNodes, switchHead };
}
