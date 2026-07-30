import { memo, useState, useCallback, useEffect } from 'react';
import { Modal, Form, Input, Select, App } from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import type { ProjectMeta } from '@qcqx/lattice-core';
import { post } from '../../api/request';

export const ProjectEditModal = memo(function ProjectEditModal({
  open,
  onClose,
  project,
}: {
  open: boolean;
  onClose: () => void;
  project: ProjectMeta | null;
}) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (project && open) {
      form.setFieldsValue({
        name: project.name,
        description: project.description ?? '',
        groups: project.groups?.join(', ') ?? '',
        tags: project.tags?.join(', ') ?? '',
      });
    }
  }, [project, open, form]);

  const handleSave = useCallback(async () => {
    if (!project) return;
    try {
      const values = await form.validateFields();
      setSaving(true);
      await post(`/api/projects/${encodeURIComponent(project.ids[0])}/update`, {
        name: values.name,
        description: values.description || undefined,
        groups: values.groups ? values.groups.split(',').map((s: string) => s.trim()) : [],
        tags: values.tags ? values.tags.split(',').map((s: string) => s.trim()) : [],
      });
      message.success('项目已更新');
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      onClose();
    } catch (err) {
      message.error(`更新失败: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }, [project, form, message, queryClient, onClose]);

  return (
    <Modal
      title={`编辑项目 - ${project?.name ?? ''}`}
      open={open}
      onCancel={onClose}
      onOk={handleSave}
      confirmLoading={saving}
      width={480}>
      <Form form={form} layout='vertical' size='small'>
        <Form.Item name='name' label='名称' rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name='description' label='描述'>
          <Input.TextArea rows={2} />
        </Form.Item>
        <Form.Item name='groups' label='分组（逗号分隔）'>
          <Input placeholder='frontend, backend' />
        </Form.Item>
        <Form.Item name='tags' label='标签（逗号分隔）'>
          <Input placeholder='stable, experimental' />
        </Form.Item>
      </Form>
    </Modal>
  );
});

/** 项目注销确认 Modal */
export function useProjectRemove() {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();

  return useCallback(
    (project: ProjectMeta) => {
      modal.confirm({
        title: '注销项目',
        content: `确认注销「${project.name}」？项目将移入垃圾桶，可恢复。`,
        okType: 'danger',
        onOk: async () => {
          try {
            await post(`/api/projects/${encodeURIComponent(project.ids[0])}/remove`);
            message.success('项目已注销');
            queryClient.invalidateQueries({ queryKey: ['projects'] });
          } catch {
            message.error('注销失败');
          }
        },
      });
    },
    [message, modal, queryClient],
  );
}

/** 项目关系添加 Modal */
export const RelationModal = memo(function RelationModal({
  open,
  onClose,
  projectId,
  projects,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  projects: ProjectMeta[];
}) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  const handleSave = useCallback(async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      await post(`/api/projects/${encodeURIComponent(projectId)}/relations`, {
        projectB: values.projectB,
        type: values.type,
        description: values.description || undefined,
      });
      message.success('关系已添加');
      queryClient.invalidateQueries({ queryKey: ['relations'] });
      form.resetFields();
      onClose();
    } catch (err) {
      if ((err as Error).message) {
        message.error(`添加失败: ${(err as Error).message}`);
      }
    } finally {
      setSaving(false);
    }
  }, [form, projectId, message, queryClient, onClose]);

  const relationTypes = [
    { label: 'depends-on', value: 'depends-on' },
    { label: 'forked-from', value: 'forked-from' },
    { label: 'shares-component', value: 'shares-component' },
    { label: 'nested-in', value: 'nested-in' },
    { label: 'related', value: 'related' },
  ];

  return (
    <Modal
      title='添加项目关系'
      open={open}
      onCancel={onClose}
      onOk={handleSave}
      confirmLoading={saving}
      width={480}>
      <Form form={form} layout='vertical' size='small'>
        <Form.Item name='projectB' label='目标项目' rules={[{ required: true }]}>
          <Select
            showSearch
            placeholder='选择目标项目'
            options={projects
              .filter((p) => !p.ids.includes(projectId))
              .map((p) => ({ label: p.name, value: p.ids[0] }))}
          />
        </Form.Item>
        <Form.Item name='type' label='关系类型' rules={[{ required: true }]} initialValue='related'>
          <Select options={relationTypes} />
        </Form.Item>
        <Form.Item name='description' label='描述'>
          <Input.TextArea rows={2} placeholder='关系描述（可选）' />
        </Form.Item>
      </Form>
    </Modal>
  );
});
