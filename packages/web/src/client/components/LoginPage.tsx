import { useState } from 'react';
import { Card, Form, Input, Button, Checkbox, App } from 'antd';
import { LockOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router';
import { getAdapter } from '../adapters';
import { saveToken } from '../store';

export function LoginPage() {
  const [loading, setLoading] = useState(false);
  const { message } = App.useApp();
  const navigate = useNavigate();

  const onFinish = async (values: { password: string; remember: boolean }) => {
    setLoading(true);
    try {
      const { token } = await getAdapter().login(values.password, values.remember);
      saveToken(token, values.remember);
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
        background: 'var(--bg-primary, #f5f5f5)',
      }}>
      <Card style={{ width: 360 }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <LockOutlined style={{ fontSize: 36, color: '#1677FF' }} />
          <h2 style={{ margin: '12px 0 4px' }}>Lattice Web</h2>
          <p style={{ color: 'var(--text-tertiary, #999)', margin: 0 }}>请输入访问密码</p>
        </div>
        <Form onFinish={onFinish} initialValues={{ remember: true }}>
          <Form.Item name='password' rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password prefix={<LockOutlined />} placeholder='密码' size='large' autoFocus />
          </Form.Item>
          <Form.Item name='remember' valuePropName='checked'>
            <Checkbox>记住登录（30 天）</Checkbox>
          </Form.Item>
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
