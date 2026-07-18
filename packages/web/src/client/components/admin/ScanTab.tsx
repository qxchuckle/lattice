import { memo, useState, useCallback, useEffect, useRef } from 'react';
import { Button, Input, Progress, App, List, Tag } from 'antd';
import { ScanOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { useQuery } from '@tanstack/react-query';
import { getAdapter } from '../../adapters';
import { getAuthHeaders } from '../../lib';

interface ScanProgress {
  current: number;
  total: number;
  added?: number;
  updated?: number;
  currentFile?: string;
}

export const ScanTab = memo(function ScanTab() {
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  const [dirs, setDirs] = useState('');
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [result, setResult] = useState<{ added: string[]; updated: string[] } | null>(null);
  const [running, setRunning] = useState(false);

  const initializedRef = useRef(false);

  // 预填 scanDirs
  const { data: configData } = useQuery({
    queryKey: ['config', 'local'],
    queryFn: () => getAdapter().getConfig('local'),
    staleTime: 60_000,
  });

  useEffect(() => {
    if (configData?.scanDirs && !initializedRef.current) {
      setDirs((configData.scanDirs as string[]).join('\n'));
      initializedRef.current = true;
    }
  }, [configData]);

  const handleScan = useCallback(async () => {
    const dirList = dirs
      .split('\n')
      .map((d) => d.trim())
      .filter(Boolean);

    if (dirList.length === 0) {
      message.warning('请输入至少一个扫描目录');
      return;
    }

    setRunning(true);
    setProgress({ current: 0, total: 0 });
    setResult(null);

    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ dirs: dirList }),
      });
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
                message.error(`扫描失败: ${data.error}`);
              } else {
                setResult(data.result);
                message.success(
                  `扫描完成：新增 ${data.result.added?.length ?? 0} 个，更新 ${data.result.updated?.length ?? 0} 个`,
                );
                queryClient.invalidateQueries();
              }
              return;
            }
            setProgress(data);
          }
        }
      }
      message.warning('连接已断开，请重试');
    } catch (err) {
      message.error(`扫描失败: ${(err as Error).message}`);
    } finally {
      setProgress(null);
      setRunning(false);
    }
  }, [dirs, message, queryClient]);

  const pct =
    progress && progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

  return (
    <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Input.TextArea
        placeholder='扫描目录（每行一个路径）'
        value={dirs}
        onChange={(e) => setDirs(e.target.value)}
        rows={4}
        disabled={running}
      />
      <Button type='primary' icon={<ScanOutlined />} loading={running} onClick={handleScan} block>
        开始扫描
      </Button>

      {progress && (
        <div>
          <Progress percent={pct} status='active' />
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
            {progress.currentFile ? progress.currentFile.slice(-60) : '扫描中...'}
            {progress.added ? ` · +${progress.added}` : ''}
            {progress.updated ? ` · ~${progress.updated}` : ''}
          </div>
        </div>
      )}

      {result && (
        <div>
          {result.added && result.added.length > 0 && (
            <>
              <div style={{ fontSize: 12, margin: '8px 0 4px' }}>
                <Tag color='green'>新增 {result.added.length}</Tag>
              </div>
              <List
                size='small'
                dataSource={result.added}
                renderItem={(name) => <List.Item>{name}</List.Item>}
              />
            </>
          )}
          {result.updated && result.updated.length > 0 && (
            <>
              <div style={{ fontSize: 12, margin: '8px 0 4px' }}>
                <Tag color='blue'>更新 {result.updated.length}</Tag>
              </div>
              <List
                size='small'
                dataSource={result.updated}
                renderItem={(name) => <List.Item>{name}</List.Item>}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
});
