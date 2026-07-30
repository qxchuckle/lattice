import { memo, useState, useCallback } from 'react';
import { Modal, Form, Input, Select, App } from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import { post } from '../../api/request';

export const TaskCreateModal = memo(function TaskCreateModal({
  open,
  onClose,
  projectId,
  projects,
}: {
  open: boolean;
  onClose: () => void;
  projectId?: string;
  projects?: { id: string; name: string }[];
}) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  const handleSave = useCallback(async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      const data = await post<{ id: string }>('/api/tasks/create', {
        title: values.title,
        projectIds: values.projectIds,
        parentTaskId: values.parentTaskId || undefined,
      });
      message.success(`任务已创建: ${data.id}`);
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      form.resetFields();
      onClose();
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
      title='创建任务'
      open={open}
      onCancel={onClose}
      onOk={handleSave}
      confirmLoading={saving}
      width={480}>
      <Form
        form={form}
        layout='vertical'
        size='small'
        initialValues={{ projectIds: projectId ? [projectId] : [] }}>
        <Form.Item name='title' label='标题' rules={[{ required: true }]}>
          <Input placeholder='任务标题' />
        </Form.Item>
        <Form.Item name='projectIds' label='关联项目'>
          <Select
            mode='multiple'
            placeholder='选择关联项目'
            options={projects?.map((p) => ({ label: p.name, value: p.id }))}
          />
        </Form.Item>
        <Form.Item name='parentTaskId' label='父任务 ID（可选）'>
          <Input placeholder='父任务 ID' />
        </Form.Item>
      </Form>
    </Modal>
  );
});
