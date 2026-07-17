import { memo } from 'react';
import { Alert, Button } from 'antd';
import { useSnapshot } from 'valtio';
import { authStore, openAdmin } from '../store';

/**
 * 未设置密码时的安全提示条。
 * authStore.authEnabled === false 且已初始化时显示，引导用户设置密码。
 */
export const SecurityNoticeBar = memo(function SecurityNoticeBar() {
  const { authEnabled, initialized } = useSnapshot(authStore);
  if (!initialized || authEnabled) return null;
  return (
    <Alert
      type='warning'
      showIcon
      banner
      message='未设置访问密码'
      description='当前 web 面板无鉴权，frp 暴露到公网存在安全风险。建议在配置管理 → 本机配置中设置访问密码。'
      action={
        <Button size='small' type='primary' onClick={() => openAdmin()}>
          去设置
        </Button>
      }
      style={{ position: 'relative', zIndex: 50 }}
    />
  );
});
