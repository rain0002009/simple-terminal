import type { FC } from 'react'
import { useMemo, useState } from 'react'
import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
} from '@ant-design/icons'
import {
  Button,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Tag,
  Typography,
} from 'antd'
import type { CustomCommand } from '../features/koko/types'

const { Paragraph, Text } = Typography

type CustomCommandFormValues = {
  name: string
  content: string
  tag: string
}

type CustomCommandManagerModalProps = {
  open: boolean
  commands: CustomCommand[]
  tagOptions: Array<{ label: string; value: string }>
  onCancel: () => void
  onCreate: (command: Omit<CustomCommand, 'id'>) => void
  onUpdate: (command: CustomCommand) => void
  onDelete: (id: string) => void
}

const createEmptyFormValues = (): CustomCommandFormValues => ({
  name: '',
  content: '',
  tag: '',
})

export const CustomCommandManagerModal: FC<CustomCommandManagerModalProps> = ({
  open,
  commands,
  tagOptions,
  onCancel,
  onCreate,
  onUpdate,
  onDelete,
}) => {
  const [form] = Form.useForm<CustomCommandFormValues>()
  const [editingId, setEditingId] = useState('')

  const editingCommand = useMemo(
    () => commands.find((item) => item.id === editingId) ?? null,
    [commands, editingId],
  )

  const activeEditingId = editingCommand ? editingId : ''

  const resetForm = () => {
    setEditingId('')
    form.setFieldsValue(createEmptyFormValues())
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setEditingId('')
      form.resetFields()
    }
  }

  const handleEditCommand = (command: CustomCommand) => {
    setEditingId(command.id)
    form.setFieldsValue({
      name: command.name,
      content: command.content,
      tag: command.tag,
    })
  }

  const handleDeleteCommand = (id: string) => {
    onDelete(id)
    if (id === activeEditingId) resetForm()
  }

  const handleSubmit = async () => {
    const values = await form.validateFields()
    const payload = {
      name: values.name.trim(),
      content: values.content,
      tag: values.tag?.trim() ?? '',
    }

    if (editingCommand) {
      onUpdate({
        id: editingCommand.id,
        ...payload,
      })
      return
    }

    onCreate(payload)
    resetForm()
  }

  const handleCreateNew = () => {
    resetForm()
  }

  return (
    <Modal
      title="管理自定义命令"
      open={open}
      onCancel={onCancel}
      afterOpenChange={handleOpenChange}
      footer={null}
      destroyOnHidden
      width={960}
      styles={{ body: { paddingTop: 12 } }}
    >
      <div className="flex gap-4 max-md:flex-col">
        <div className="flex w-[360px] flex-col gap-3 max-md:w-full">
          <div className="flex items-center justify-between gap-3">
            <Text strong>已保存命令</Text>
            <Button type="primary" icon={<PlusOutlined />} onClick={handleCreateNew}>
              新建命令
            </Button>
          </div>

          {commands.length === 0 ? (
            <div className="rounded-[12px] border border-dashed border-[rgba(100,116,139,0.28)] px-4 py-8">
              <Empty description="还没有自定义命令，先在右侧创建一个。" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            </div>
          ) : (
            <div className="flex max-h-[440px] flex-col gap-2 overflow-auto pr-1">
              {commands.map((command) => {
                const selected = command.id === activeEditingId
                return (
                  <div
                    key={command.id}
                    className={`rounded-[12px] border p-3 transition-colors ${
                      selected
                        ? 'border-[rgba(22,119,255,0.72)] bg-[rgba(22,119,255,0.12)]'
                        : 'border-[rgba(100,116,139,0.24)] bg-[rgba(15,23,42,0.4)]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <Space size={8} wrap>
                          <Text strong>{command.name}</Text>
                          {command.tag ? <Tag color="blue">{command.tag}</Tag> : null}
                        </Space>
                        <Paragraph className="!mb-0 !mt-2" ellipsis={{ rows: 2, expandable: false }} type="secondary">
                          {command.content}
                        </Paragraph>
                      </div>
                      <Space direction="vertical" size={8}>
                        <Button
                          size="small"
                          icon={<EditOutlined />}
                          onClick={() => handleEditCommand(command)}
                        >
                          编辑
                        </Button>
                        <Popconfirm
                          title="确认删除此自定义命令？"
                          okText="删除"
                          cancelText="取消"
                          okButtonProps={{ danger: true }}
                          onConfirm={() => handleDeleteCommand(command.id)}
                        >
                          <Button danger size="small" icon={<DeleteOutlined />}>
                            删除
                          </Button>
                        </Popconfirm>
                      </Space>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1 rounded-[12px] border border-[rgba(100,116,139,0.24)] bg-[rgba(15,23,42,0.4)] p-4">
          <Space className="w-full" direction="vertical" size="middle">
            <div>
              <Text strong>{editingCommand ? '编辑命令' : '创建命令'}</Text>
              <div className="mt-1">
                <Text type="secondary" className="text-[13px]">
                  标签下拉选项与左侧“连接控制”里的连接令牌下拉保持一致，用于在命令面板中优先展示匹配当前终端标签的命令。
                </Text>
              </div>
            </div>

            <Form<CustomCommandFormValues>
              form={form}
              layout="vertical"
              initialValues={createEmptyFormValues()}
            >
              <Form.Item label="命令名称" name="name" rules={[{ required: true, message: '请输入命令名称' }]}>
                <Input placeholder="例如：查看应用日志" maxLength={60} />
              </Form.Item>

              <Form.Item label="命令内容" name="content" rules={[{ required: true, message: '请输入命令内容' }]}>
                <Input.TextArea
                  autoSize={{ minRows: 6, maxRows: 10 }}
                  placeholder="例如：tail -f /var/log/app.log"
                />
              </Form.Item>

              <Form.Item label="标签" name="tag">
                <Select
                  allowClear
                  options={tagOptions}
                  placeholder="选择与资产相关的标签（可选）"
                  showSearch
                  optionFilterProp="label"
                />
              </Form.Item>

              <Space>
                <Button type="primary" onClick={() => void handleSubmit()}>
                  {editingCommand ? '保存修改' : '添加命令'}
                </Button>
                {editingCommand ? <Button onClick={handleCreateNew}>取消编辑</Button> : null}
              </Space>
            </Form>
          </Space>
        </div>
      </div>
    </Modal>
  )
}
