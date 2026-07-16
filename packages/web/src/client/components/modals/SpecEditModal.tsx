import { memo, useState, useCallback } from 'react';
import { Modal, Form, Input, Select, App, Tag, List, Empty } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { SpecLintReport } from '@qcqx/lattice-core';

/** Spec 创建 Modal */
export const SpecCreateModal = memo(function SpecCreateModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  const handleSave = useCallback(async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      const res = await fetch('/api/specs/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const data = await res.json();
      if (data.success) {
        message.success('Spec 已创建');
        queryClient.invalidateQueries({ queryKey: ['specs'] });
        form.resetFields();
        onClose();
      } else {
        message.error(data.message ?? '创建失败');
      }
    } catch (err) {
      if ((err as Error).message) {
        message.error(`创建失败: ${(err as Error).message}`);
      }
    } finally {
      setSaving(false);
    }
  }, [form, message, queryClient, onClose]);

  return (
    <Modal
      title='创建 Spec'
      open={open}
      onCancel={onClose}
      onOk={handleSave}
      confirmLoading={saving}
      width={480}>
      <Form form={form} layout='vertical' size='small'>
        <Form.Item
          name='relativePath'
          label='相对路径'
          rules={[{ required: true }]}
          tooltip='如：my-spec.md'>
          <Input placeholder='my-spec.md' />
        </Form.Item>
        <Form.Item name='scope' label='层级' rules={[{ required: true }]} initialValue='project'>
          <Select
            options={[
              { label: '项目级', value: 'project' },
              { label: '用户级', value: 'user' },
              { label: '全局级', value: 'global' },
            ]}
          />
        </Form.Item>
        <Form.Item name='title' label='标题' rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item
          name='description'
          label='摘要'
          rules={[{ required: true }]}
          tooltip='三段式：作用范围 + 约束 + 作用'>
          <Input.TextArea rows={2} />
        </Form.Item>
        <Form.Item name='tags' label='标签（逗号分隔）'>
          <Input placeholder='stable, experimental' />
        </Form.Item>
      </Form>
    </Modal>
  );
});

/** Spec Frontmatter 编辑 Modal */
export const SpecFrontmatterModal = memo(function SpecFrontmatterModal({
  open,
  onClose,
  specId,
  specPath,
}: {
  open: boolean;
  onClose: () => void;
  specId: string;
  specPath: string;
}) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  const handleSave = useCallback(async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      const res = await fetch(`/api/specs/${encodeURIComponent(specId)}/frontmatter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: values.title,
          description: values.description,
          tags: values.tags ? values.tags.split(',').map((s: string) => s.trim()) : [],
        }),
      });
      const data = await res.json();
      if (data.success) {
        message.success('Frontmatter 已更新，RAG 索引已自动更新');
        queryClient.invalidateQueries({ queryKey: ['specs'] });
        queryClient.invalidateQueries({ queryKey: ['rag-status'] });
        onClose();
      } else {
        message.error(data.message ?? '更新失败');
      }
    } catch (err) {
      if ((err as Error).message) {
        message.error(`更新失败: ${(err as Error).message}`);
      }
    } finally {
      setSaving(false);
    }
  }, [form, specId, message, queryClient, onClose]);

  return (
    <Modal
      title={`编辑 Frontmatter - ${specPath}`}
      open={open}
      onCancel={onClose}
      onOk={handleSave}
      confirmLoading={saving}
      width={480}>
      <Form form={form} layout='vertical' size='small'>
        <Form.Item name='title' label='标题' rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name='description' label='摘要' rules={[{ required: true }]}>
          <Input.TextArea rows={2} />
        </Form.Item>
        <Form.Item name='tags' label='标签（逗号分隔）'>
          <Input placeholder='stable, experimental' />
        </Form.Item>
      </Form>
    </Modal>
  );
});

/** Spec Lint 结果 Modal */
export const SpecLintModal = memo(function SpecLintModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { data: lintResult, isLoading } = useQuery({
    queryKey: ['spec-lint'],
    queryFn: async () => {
      const res = await fetch('/api/specs/lint', { method: 'POST' });
      return (await res.json()) as SpecLintReport[];
    },
    enabled: open,
  });

  return (
    <Modal title='Spec Lint 检查' open={open} onCancel={onClose} footer={null} width={600}>
      {isLoading ? (
        <div>检查中...</div>
      ) : !lintResult || lintResult.length === 0 ? (
        <Empty description='无问题' />
      ) : (
        <List
          size='small'
          dataSource={lintResult}
          renderItem={(report, i) => (
            <List.Item key={i}>
              <List.Item.Meta
                title={report.filePath}
                description={
                  <div>
                    {report.issues?.map((issue, j) => (
                      <Tag key={j} color={issue.severity === 'error' ? 'red' : 'orange'}>
                        {issue.severity}
                      </Tag>
                    ))}
                  </div>
                }
              />
            </List.Item>
          )}
        />
      )}
    </Modal>
  );
});

/** Spec 冲突检测 Modal */
export const SpecConflictsModal = memo(function SpecConflictsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { data: conflicts, isLoading } = useQuery({
    queryKey: ['spec-conflicts'],
    queryFn: async () => {
      const res = await fetch('/api/specs/conflicts', { method: 'POST' });
      return (await res.json()) as {
        fileName: string;
        levels: { scope: string; filePath: string }[];
      }[];
    },
    enabled: open,
  });

  return (
    <Modal title='Spec 冲突检测' open={open} onCancel={onClose} footer={null} width={600}>
      {isLoading ? (
        <div>检测中...</div>
      ) : !conflicts || conflicts.length === 0 ? (
        <Empty description='无冲突' />
      ) : (
        <List
          size='small'
          dataSource={conflicts}
          renderItem={(conflict, i) => (
            <List.Item key={i}>
              <List.Item.Meta
                title={conflict.fileName}
                description={
                  <div>
                    {conflict.levels.map((level, j) => (
                      <div key={j}>
                        <Tag>{level.scope}</Tag>
                        <span style={{ fontSize: 11 }}>{level.filePath}</span>
                      </div>
                    ))}
                  </div>
                }
              />
            </List.Item>
          )}
        />
      )}
    </Modal>
  );
});
