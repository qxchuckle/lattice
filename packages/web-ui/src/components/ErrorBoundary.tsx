import { t } from '../i18n';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Result, Button } from 'antd';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/** 全局错误边界 — 捕获子组件树的 JavaScript 错误，防止白屏 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <Result
          status='error'
          title={t('页面出错了', 'Page error')}
          subTitle={this.state.error?.message || t('发生未知错误', 'Unknown error')}
          extra={
            <>
              <Button type='primary' onClick={() => location.reload()}>
                {t('刷新页面', 'Reload')}
              </Button>
              <pre
                style={{
                  textAlign: 'left',
                  fontSize: 11,
                  maxHeight: '40vh',
                  overflow: 'auto',
                  marginTop: 12,
                  whiteSpace: 'pre-wrap',
                  color: 'var(--text-secondary)',
                }}>
                {String(this.state.error?.stack ?? '')}
              </pre>
            </>
          }
        />
      );
    }
    return this.props.children;
  }
}
