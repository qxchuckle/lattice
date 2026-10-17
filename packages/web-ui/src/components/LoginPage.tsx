import { useState } from 'react';
import { Card, Form, Input, Button, App, theme } from 'antd';
import { LockOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router';
import { getAdapter } from '../adapters';
import { saveToken } from '../store';

export function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [remember, setRemember] = useState(true);
  const { message } = App.useApp();
  const navigate = useNavigate();
  // 用 antd 主题 token 适配深色/浅色主题，避免硬编码颜色
  const { token: themeToken } = theme.useToken();

  const onFinish = async (values: { password: string }) => {
    setLoading(true);
    try {
      const { token } = await getAdapter().login(values.password, remember);
      saveToken(token, remember);
      message.success('登录成功');
      navigate('/');
    } catch (err) {
      const msg = (err as Error).message;
      message.error(msg === 'unauthorized' || msg === 'HTTP 401' ? '密码错误' : `登录失败: ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
        background: themeToken.colorBgLayout,
      }}>
      <Card style={{ width: 360, background: themeToken.colorBgContainer }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <LockOutlined style={{ fontSize: 36, color: themeToken.colorPrimary }} />
          <h2 style={{ margin: '12px 0 4px', color: themeToken.colorText }}>Lattice Web</h2>
          <p style={{ color: themeToken.colorTextSecondary, margin: 0 }}>请输入访问密码</p>
        </div>
        <Form onFinish={onFinish}>
          <Form.Item name='password' rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password prefix={<LockOutlined />} placeholder='密码' size='large' autoFocus />
          </Form.Item>
          <label
            style={{
              marginBottom: 24,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              cursor: 'pointer',
              userSelect: 'none',
              color: themeToken.colorTextSecondary,
              fontSize: 13,
            }}>
            <input
              type='checkbox'
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              style={{
                width: 14,
                height: 14,
                accentColor: themeToken.colorPrimary,
                cursor: 'pointer',
              }}
            />
            记住登录（30 天）
          </label>
          <Form.Item>
            <Button type='primary' htmlType='submit' loading={loading} block size='large'>
              登录
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}
