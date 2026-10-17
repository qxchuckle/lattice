import { t } from '../../i18n';
import { memo, useState, useCallback, useEffect } from 'react';
import { Modal, Form, Select, Input, App } from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import { getAdapter } from '../../adapters';

const CHECKPOINT_TYPES = [
  { label: t('context - 背景/需求', 'context - Background / requirement'), value: 'context' },
  { label: t('correction - 纠错', 'correction - Correction'), value: 'correction' },
  { label: t('constraint - 约束', 'constraint - Constraint'), value: 'constraint' },
  { label: t('assumption - 推断', 'assumption - Assumption'), value: 'assumption' },
  { label: t('followup - 待办', 'followup - Follow-up'), value: 'followup' },
  { label: t('note - 事实', 'note - Fact'), value: 'note' },
  { label: t('decision - 决策', 'decision - Decision'), value: 'decision' },
  { label: t('pivot - 方向转折', 'pivot - Pivot'), value: 'pivot' },
  { label: t('milestone - 里程碑', 'milestone - Milestone'), value: 'milestone' },
  { label: t('issue - 踩坑', 'issue - Issue'), value: 'issue' },
  { label: t('summary - 总结', 'summary - Summary'), value: 'summary' },
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
      message.success(t('Checkpoint 已添加', 'Checkpoint added'));
      queryClient.invalidateQueries({ queryKey: ['task-progress', taskId] });
      queryClient.invalidateQueries({ queryKey: ['checkpoints'] });
      form.resetFields();
      onClose();
    } catch (err) {
      if ((err as Error).message) {
        message.error(
          t(`添加失败: ${(err as Error).message}`, `Failed to add: ${(err as Error).message}`),
        );
      }
    } finally {
      setSaving(false);
    }
  }, [form, taskId, message, queryClient, onClose]);

  return (
    <Modal
      title={t('添加 Checkpoint', 'Add checkpoint')}
      open={open}
      onCancel={onClose}
      onOk={handleSave}
      confirmLoading={saving}
      width={480}>
      <Form form={form} layout='vertical' size='small'>
        <Form.Item
          name='type'
          label={t('类型', 'Type')}
          rules={[{ required: true, message: t('请选择类型', 'Please choose a type') }]}>
          <Select options={CHECKPOINT_TYPES} />
        </Form.Item>
        <Form.Item
          name='title'
          label={t('标题', 'Title')}
          rules={[{ required: true, message: t('请输入标题', 'Please enter a title') }]}>
          <Input placeholder={t('检查点标题', 'Checkpoint title')} />
        </Form.Item>
        <Form.Item name='message' label={t('内容', 'Content')}>
          <Input.TextArea rows={4} placeholder={t('详细内容', 'Details')} />
        </Form.Item>
      </Form>
    </Modal>
  );
});
