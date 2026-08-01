/**
 * ConnectionIndicator — Agent WebSocket 连接状态指示器 + 可操作错误反馈
 *
 * 批次四新增：
 * - 订阅 connectionState$ 显示 connected/connecting/reconnecting/disconnected
 * - reconnecting 时浮动 toast 提示网络失败 + 可点击重试
 * - authStore 鉴权过期（token 清除）时提示重新登录
 */
import { memo, useEffect, useRef } from 'react';
import { Badge, Tooltip, App as AntdApp } from 'antd';
import { useConnectionState } from './useConnectionState';
import { connectAgentWs, disconnectAgentWs } from './connection';
import { authStore } from '../../store';
import { useSnapshot } from 'valtio';

const STATE_CONFIG = {
  connected: { color: 'success' as const, label: '已连接', dot: 'green' },
  connecting: { color: 'processing' as const, label: '连接中', dot: 'blue' },
  reconnecting: { color: 'warning' as const, label: '重连中', dot: 'orange' },
  disconnected: { color: 'default' as const, label: '未连接', dot: 'gray' },
};

export const ConnectionIndicator = memo(function ConnectionIndicator() {
  const connState = useConnectionState();
  const { message, notification } = AntdApp.useApp();
  const { token, initialized, authEnabled } = useSnapshot(authStore);

  // 上一状态 ref（仅在状态转换时触发 toast，避免重复弹出）
  const prevStateRef = useRef(connState.type);
  const notifiedReconnecting = useRef(false);

  // 状态转换时触发可操作反馈
  useEffect(() => {
    const prev = prevStateRef.current;
    const current = connState.type;

    // connected → 清除重连提示标记
    if (current === 'connected') {
      notifiedReconnecting.current = false;
    }

    // 进入 reconnecting → 提示网络失败 + 可重试
    if (current === 'reconnecting' && !notifiedReconnecting.current) {
      notifiedReconnecting.current = true;
      const reason = connState.type === 'reconnecting' ? connState.reason : '';
      const reasonText: Record<string, string> = {
        'connection-lost': '连接断开',
        'connect-failed': '连接服务器失败',
        'heartbeat-timeout': '连接超时',
      };
      notification.warning({
        message: 'Agent 连接中断',
        description: `${reasonText[reason] || '网络异常'}，正在自动重连…（第 ${connState.type === 'reconnecting' ? connState.attempt : 0} 次）`,
        duration: 4,
        placement: 'bottomRight',
      });
    }

    // 从 reconnecting 恢复到 connected → 成功提示
    if (prev === 'reconnecting' && current === 'connected') {
      message.success('Agent 连接已恢复', 2);
    }

    prevStateRef.current = current;
  }, [connState, message, notification]);

  // 鉴权过期检测：token 被清除且鉴权启用 → 提示重新登录
  const prevTokenRef = useRef(token);
  useEffect(() => {
    if (prevTokenRef.current && !token && initialized && authEnabled) {
      notification.error({
        message: '鉴权已过期',
        description: '请重新登录以恢复 Agent 连接',
        duration: 0, // 不自动消失，需用户手动关闭
        placement: 'bottomRight',
        btn: null,
      });
    }
    prevTokenRef.current = token;
  }, [token, initialized, authEnabled, notification]);

  const config = STATE_CONFIG[connState.type];

  const handleRetry = () => {
    if (connState.type === 'disconnected' || connState.type === 'reconnecting') {
      // reconnecting 态先断开旧连接（清 socket$/connSub），避免泄漏多 WebSocket
      if (connState.type === 'reconnecting') disconnectAgentWs();
      connectAgentWs();
    }
  };

  const isActionable = connState.type === 'disconnected' || connState.type === 'reconnecting';

  return (
    <Tooltip
      title={
        isActionable ? (
          <span>
            {config.label} — <a onClick={handleRetry}>点击重试</a>
          </span>
        ) : (
          config.label
        )
      }>
      <Badge
        status={config.color}
        style={{
          cursor: isActionable ? 'pointer' : 'default',
          minWidth: isActionable ? 44 : undefined,
          minHeight: isActionable ? 44 : undefined,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: isActionable ? '8px 12px' : undefined,
        }}
        onClick={isActionable ? handleRetry : undefined}
      />
    </Tooltip>
  );
});
