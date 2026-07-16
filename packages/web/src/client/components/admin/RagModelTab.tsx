import { memo, useState, useCallback } from 'react';
import { Card, Descriptions, Tag, Button, Progress, App, Space } from 'antd';
import {
  ReloadOutlined,
  ThunderboltOutlined,
  DeleteOutlined,
  DownloadOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getAdapter } from '../../adapters';

interface RagProgress {
  current: number;
  total: number;
  added?: number;
  updated?: number;
  skipped?: number;
  chunksProcessed?: number;
  currentFile?: string;
}

export const RagModelTab = memo(function RagModelTab() {
  const queryClient = useQueryClient();
  const { message, modal } = App.useApp();
  const [progress, setProgress] = useState<RagProgress | null>(null);
  const [running, setRunning] = useState(false);

  const { data: ragStatus, refetch: refetchRag } = useQuery({
    queryKey: ['rag-status'],
    queryFn: () => getAdapter().getRagStatus(),
    staleTime: 30_000,
  });

  const { data: modelStatus, refetch: refetchModel } = useQuery({
    queryKey: ['model-status'],
    queryFn: () => getAdapter().getModelStatus(),
    staleTime: 30_000,
  });

  const handleRagOperation = useCallback(
    async (operation: 'update' | 'rebuild') => {
      setRunning(true);
      setProgress({ current: 0, total: 0 });
      const url = `/api/rag/${operation}`;
      try {
        const res = await fetch(url, { method: 'POST' });
        if (!res.ok) {
          const errBody = await res.json().catch(() => null);
          throw new Error(errBody?.message ?? `HTTP ${res.status}`);
        }
        const reader = res.body?.getReader();
        if (!reader) throw new Error('无法读取响应流');
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = JSON.parse(line.slice(6));
              if (data.done) {
                if (data.error) {
                  message.error(`操作失败: ${data.error}`);
                } else {
                  message.success(`${operation === 'update' ? '增量更新' : '全量重建'}完成`);
                }
                refetchRag();
                refetchModel();
                queryClient.invalidateQueries();
                return;
              }
              setProgress(data);
            }
          }
        }
        message.warning('连接已断开，请重试');
      } catch (err) {
        message.error(`操作失败: ${(err as Error).message}`);
      } finally {
        setProgress(null);
        setRunning(false);
      }
    },
    [message, refetchRag, refetchModel, queryClient],
  );

  const handleModelDownload = useCallback(async () => {
    setRunning(true);
    setProgress({ current: 0, total: 1 });
    try {
      const res = await fetch('/api/rag/model/download', { method: 'POST' });
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(errBody?.message ?? `HTTP ${res.status}`);
      }
      const reader = res.body?.getReader();
      if (!reader) throw new Error('无法读取响应流');
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = JSON.parse(line.slice(6));
            if (data.done) {
              if (data.error) {
                message.error(`下载失败: ${data.error}`);
              } else {
                message.success('模型下载完成');
              }
              refetchModel();
              return;
            }
          }
        }
      }
      message.warning('连接已断开，请重试');
    } catch (err) {
      message.error(`下载失败: ${(err as Error).message}`);
    } finally {
      setProgress(null);
      setRunning(false);
    }
  }, [message, refetchModel]);

  const handleModelRemove = useCallback(() => {
    modal.confirm({
      title: '删除已安装的模型',
      content: '删除后需要重新下载，确定继续吗？',
      onOk: async () => {
        try {
          await getAdapter().removeModel();
          message.success('模型已删除');
          refetchModel();
        } catch (err) {
          message.error(`删除失败: ${(err as Error).message}`);
          throw err;
        }
      },
    });
  }, [modal, message, refetchModel]);

  const pct =
    progress && progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

  return (
    <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      {progress && (
        <Card size='small'>
          <Progress percent={pct} status='active' />
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
            {progress.current}/{progress.total}
            {progress.chunksProcessed ? ` · ${progress.chunksProcessed} chunks` : ''}
            {progress.currentFile ? ` · ${progress.currentFile.split('/').pop()}` : ''}
          </div>
        </Card>
      )}

      {ragStatus && (
        <Card
          size='small'
          title='RAG 索引'
          extra={
            <Space>
              <Button
                size='small'
                icon={<ReloadOutlined />}
                loading={running}
                onClick={() => handleRagOperation('update')}>
                增量更新
              </Button>
              <Button
                size='small'
                icon={<ThunderboltOutlined />}
                loading={running}
                onClick={() => handleRagOperation('rebuild')}>
                全量重建
              </Button>
            </Space>
          }>
          <Descriptions column={1} size='small'>
            <Descriptions.Item label='模型 ID'>{ragStatus.modelId}</Descriptions.Item>
            <Descriptions.Item label='维度'>{ragStatus.vectorDimension}</Descriptions.Item>
            <Descriptions.Item label='精度'>
              {ragStatus.dtype} / {ragStatus.pooling}
            </Descriptions.Item>
            <Descriptions.Item label='文档数'>{ragStatus.indexedDocuments}</Descriptions.Item>
            <Descriptions.Item label='向量数'>{ragStatus.totalEmbeddings}</Descriptions.Item>
            <Descriptions.Item label='FTS 版本'>
              <Tag
                color={
                  ragStatus.ftsIndexVersion < ragStatus.expectedFtsVersion ? 'orange' : 'green'
                }>
                v{ragStatus.ftsIndexVersion}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label='距离阈值'>{ragStatus.distanceThreshold}</Descriptions.Item>
            <Descriptions.Item label='最后更新'>{ragStatus.lastUpdated ?? '—'}</Descriptions.Item>
          </Descriptions>
        </Card>
      )}

      {modelStatus && (
        <Card
          size='small'
          title='模型管理'
          extra={
            <Space>
              {!modelStatus.installed && (
                <Button
                  size='small'
                  icon={<DownloadOutlined />}
                  loading={running}
                  onClick={handleModelDownload}>
                  下载
                </Button>
              )}
              {modelStatus.installed && (
                <Button
                  size='small'
                  icon={<ReloadOutlined />}
                  loading={running}
                  onClick={handleModelDownload}>
                  重装
                </Button>
              )}
              {modelStatus.installed && (
                <Button
                  size='small'
                  danger
                  icon={<DeleteOutlined />}
                  onClick={handleModelRemove}
                  disabled={running || modelStatus.loaded}>
                  删除
                </Button>
              )}
            </Space>
          }>
          <Descriptions column={1} size='small'>
            <Descriptions.Item label='已安装'>
              <Tag color={modelStatus.installed ? 'green' : 'red'}>
                {modelStatus.installed ? '是' : '否'}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label='已加载'>
              <Tag color={modelStatus.loaded ? 'green' : 'default'}>
                {modelStatus.loaded ? '是' : '否'}
              </Tag>
            </Descriptions.Item>
            {modelStatus.loaded && (
              <Descriptions.Item label='提示'>
                <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                  模型已加载中，无法删除。重启服务后可删除。
                </span>
              </Descriptions.Item>
            )}
            {modelStatus.loadError && (
              <Descriptions.Item label='加载错误'>
                <span style={{ color: 'var(--error-color)' }}>{modelStatus.loadError}</span>
              </Descriptions.Item>
            )}
            {modelStatus.isNetworkError && modelStatus.networkHint && (
              <Descriptions.Item label='网络提示'>
                <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap' }}>
                  {modelStatus.networkHint}
                </pre>
              </Descriptions.Item>
            )}
          </Descriptions>
        </Card>
      )}
    </div>
  );
});
