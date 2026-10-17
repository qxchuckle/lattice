import { memo, useState } from 'react';
import { Input, Button, App, Divider, Typography } from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import { useSnapshot } from 'valtio';
import { getAdapter } from '../../adapters';
import { authStore } from '../../store';

const { Text } = Typography;

/**
 * Web 面板密码设置/修改/清除区。
 * 嵌入 ConfigModal 本机配置 Tab，不走通用 config/set，走专用 /api/auth/password。
 */
export const WebPasswordSection = memo(function WebPasswordSection() {
  const { authEnabled } = useSnapshot(authStore);
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [loading, setLoading] = useState(false);

  const refreshAuthStatus = async () => {
    const status = await getAdapter().getAuthStatus();
    authStore.authEnabled = status.enabled;
    authStore.initialized = true;
  };

  const resetInputs = () => {
    setNewPwd('');
    setConfirmPwd('');
  };

  // 设置或修改密码
  const handleSave = async () => {
    if (!newPwd) {
      message.warning('请输入新密码');
      return;
    }
    if (newPwd.length < 4) {
      message.warning('密码至少 4 位');
      return;
    }
    if (newPwd !== confirmPwd) {
      message.warning('两次密码不一致');
      return;
    }
    setLoading(true);
    try {
      // 已登录用户（守卫已验证 token），无需旧密码
      await getAdapter().changePassword(newPwd);
      message.success(authEnabled ? '密码已修改' : '密码已设置');
      await refreshAuthStatus();
      queryClient.invalidateQueries({ queryKey: ['config'] });
      resetInputs();
    } catch (err) {
      message.error(`操作失败: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  // 清除密码
  const handleClear = () => {
    modal.confirm({
      title: '确认清除密码',
      content: '清除后 web 面板将无鉴权，frp 暴露场景下任何人可访问全部接口。',
      okText: '确认清除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        setLoading(true);
        try {
          await getAdapter().changePassword(null);
          message.success('密码已清除');
          await refreshAuthStatus();
          queryClient.invalidateQueries({ queryKey: ['config'] });
          resetInputs();
        } catch (err) {
          message.error(`操作失败: ${(err as Error).message}`);
        } finally {
          setLoading(false);
        }
      },
    });
  };

  return (
    <div style={{ marginTop: 16 }}>
      <Divider style={{ margin: '12px 0' }}>Web 面板密码</Divider>
      <div style={{ marginBottom: 8 }}>
        <Text type={authEnabled ? 'success' : 'warning'}>
          {authEnabled ? '● 已启用密码鉴权' : '○ 未设置密码（无鉴权）'}
        </Text>
      </div>
      <div style={{ marginBottom: 8 }}>
        <Input.Password
          placeholder={authEnabled ? '新密码（至少 4 位）' : '设置密码（至少 4 位）'}
          value={newPwd}
          onChange={(e) => setNewPwd(e.target.value)}
          size='small'
        />
      </div>
      <div style={{ marginBottom: 8 }}>
        <Input.Password
          placeholder='确认新密码'
          value={confirmPwd}
          onChange={(e) => setConfirmPwd(e.target.value)}
          size='small'
        />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button size='small' type='primary' loading={loading} onClick={handleSave}>
          {authEnabled ? '修改密码' : '设置密码'}
        </Button>
        {authEnabled && (
          <Button size='small' danger loading={loading} onClick={handleClear}>
            清除密码
          </Button>
        )}
      </div>
    </div>
  );
});
