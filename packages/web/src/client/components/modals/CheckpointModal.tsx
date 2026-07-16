import { memo, useState, useCallback, useEffect } from 'react';
import { Modal, Form, Select, Input, App } from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import { getAdapter } from '../../adapters';

const CHECKPOINT_TYPES = [
  { label: 'context - 背景/需求', value: 'context' },
  { label: 'correction - 纠错', value: 'correction' },
  { label: 'constraint - 约束', value: 'constraint' },
  { label: 'assumption - 推断', value: 'assumption' },
  { label: 'followup - 待办', value: 'followup' },
  { label: 'note - 事实', value: 'note' },
  { label: 'decision - 决策', value: 'decision' },
  { label: 'pivot - 方向转折', value: 'pivot' },
  { label: 'milestone - 里程碑', value: 'milestone' },
  { label: 'issue - 踩坑', value: 'issue' },
  { label: 'summary - 总结', value: 'summary' },
];

export const CheckpointModal = memo(function CheckpointModal({
  open,
  onClose,
  taskId,
}: {
  open: boolean;
  onClose: () => void;
  taskId: string;
}) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      form.resetFields();
    }
  }, [open, form]);

  const handleSave = useCallback(async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      const adapter = getAdapter();
      await adapter.addCheckpoint(taskId, values.type, values.title, values.message);
      message.success('Checkpoint 已添加');
      queryClient.invalidateQueries({ queryKey: ['task-progress', taskId] });
      queryClient.invalidateQueries({ queryKey: ['checkpoints'] });
      form.resetFields();
      onClose();
    } catch (err) {
      if ((err as Error).message) {
        message.error(`添加失败: ${(err as Error).message}`);
      }
    } finally {
      setSaving(false);
    }
  }, [form, taskId, message, queryClient, onClose]);

  return (
    <Modal
      title='添加 Checkpoint'
      open={open}
      onCancel={onClose}
      onOk={handleSave}
      confirmLoading={saving}
      width={480}>
      <Form form={form} layout='vertical' size='small'>
        <Form.Item name='type' label='类型' rules={[{ required: true, message: '请选择类型' }]}>
          <Select options={CHECKPOINT_TYPES} />
        </Form.Item>
        <Form.Item name='title' label='标题' rules={[{ required: true, message: '请输入标题' }]}>
          <Input placeholder='检查点标题' />
        </Form.Item>
        <Form.Item name='message' label='内容'>
          <Input.TextArea rows={4} placeholder='详细内容' />
        </Form.Item>
      </Form>
    </Modal>
  );
});
