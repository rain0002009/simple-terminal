import type { FC } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CloudUploadOutlined,
  DeleteOutlined,
  FileSearchOutlined,
  FileOutlined,
  FolderOpenOutlined,
  FolderOutlined,
  HomeOutlined,
  ReloadOutlined,
  SearchOutlined,
} from '@ant-design/icons'
import {
  Alert,
  App as AntdApp,
  Breadcrumb,
  Button,
  Descriptions,
  Empty,
  Form,
  Image,
  Input,
  Modal,
  Popconfirm,
  Space,
  Table,
  Tag,
  Typography,
  Upload,
} from 'antd'
import type { TableColumnsType } from 'antd'
import type { UploadFile } from 'antd/es/upload/interface'
import { useMemoizedFn, useRequest } from 'ahooks'

const { Paragraph, Text } = Typography
const { Dragger } = Upload

const DEFAULT_BUCKET = 'yizhan'
const IMAGE_FILE_EXTENSIONS = new Set(['avif', 'bmp', 'gif', 'ico', 'jfif', 'jpeg', 'jpg', 'png', 'svg', 'webp'])

type ObsManagerModalProps = {
  open: boolean
  onCancel: () => void
}

type ObsObjectRow = {
  key: string
  name: string
  size: number | null
  lastModified: string
  etag: string
  storageClass: string
  contentType: string
  metadata: Record<string, unknown>
}

type ObsFolderRow = {
  key: string
  name: string
  prefix: string
}

type ObsDirectoryListing = {
  prefix: string
  folders: ObsFolderRow[]
  objects: ObsObjectRow[]
}

type ObsBrowserEntry =
  | ({ entryType: 'folder' } & ObsFolderRow)
  | ({ entryType: 'object' } & ObsObjectRow)

type ObsObjectDetail = ObsObjectRow & {
  bucket?: string
  url?: string
}

type ObsUploadFormValues = {
  objectKey: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const stringifyValue = (value: unknown): string => {
  if (value === null || value === undefined || value === '') return '-'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

const extractErrorMessage = async (response: Response): Promise<string> => {
  const rawText = await response.text()
  if (!rawText) return `请求失败（${response.status}）`

  try {
    const data = JSON.parse(rawText) as Record<string, unknown>
    return stringifyValue(data.message ?? data.msg ?? data.detail ?? data.error) || `请求失败（${response.status}）`
  } catch {
    return rawText
  }
}

const parseJsonResponse = async <T,>(response: Response): Promise<T> => {
  if (!response.ok) throw new Error(await extractErrorMessage(response))
  const rawText = await response.text()
  return (rawText ? JSON.parse(rawText) : {}) as T
}

const toNumberOrNull = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

const normalizeDirectoryPath = (value: unknown): string => {
  const normalized = stringifyValue(value)
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
  return normalized === '-' ? '' : normalized
}

const joinDirectoryPath = (basePath: string, childPath: string): string => {
  const normalizedBase = normalizeDirectoryPath(basePath)
  const normalizedChild = normalizeDirectoryPath(childPath)
  if (!normalizedBase) return normalizedChild
  if (!normalizedChild) return normalizedBase
  if (normalizedChild === normalizedBase || normalizedChild.startsWith(`${normalizedBase}/`)) return normalizedChild
  return `${normalizedBase}/${normalizedChild}`
}

const getParentDirectoryPath = (path: string): string => {
  const segments = normalizeDirectoryPath(path).split('/').filter(Boolean)
  return segments.slice(0, -1).join('/')
}

const getDirectoryPrefix = (path: string): string => {
  const normalized = normalizeDirectoryPath(path)
  return normalized ? `${normalized}/` : ''
}

const getBaseName = (path: string): string => normalizeDirectoryPath(path).split('/').filter(Boolean).at(-1) ?? path

const normalizeObject = (value: unknown): ObsObjectRow => {
  const item = isRecord(value) ? value : {}
  const key = stringifyValue(item.key ?? item.name ?? item.objectKey ?? item.path)
  const metadata = isRecord(item.metadata) ? item.metadata : {}

  return {
    key,
    name: stringifyValue(item.name ?? key.split('/').filter(Boolean).at(-1) ?? key),
    size: toNumberOrNull(item.size ?? item.contentLength),
    lastModified: stringifyValue(item.lastModified ?? item.last_modified ?? item.updatedAt ?? item.updated_at),
    etag: stringifyValue(item.etag ?? item.ETag),
    storageClass: stringifyValue(item.storageClass ?? item.storage_class),
    contentType: stringifyValue(item.contentType ?? item.content_type),
    metadata,
  }
}

const normalizeFolder = (value: unknown, currentPath: string): ObsFolderRow | null => {
  const item = isRecord(value) ? value : {}
  const rawPrefix = item.prefix ?? item.key ?? item.path ?? item.name ?? value
  const prefix = joinDirectoryPath(currentPath, normalizeDirectoryPath(rawPrefix))
  if (!prefix) return null

  return {
    key: prefix,
    name: stringifyValue(item.name ?? getBaseName(prefix)),
    prefix,
  }
}

const getImmediateChildName = (objectKey: string, currentPath: string): string | null => {
  const prefix = getDirectoryPrefix(currentPath)
  if (prefix && !objectKey.startsWith(prefix)) return null

  const relativeKey = prefix ? objectKey.slice(prefix.length) : objectKey
  if (!relativeKey || relativeKey.startsWith('/')) return null
  return relativeKey.split('/').filter(Boolean)[0] ?? null
}

const isObjectInCurrentDirectory = (objectKey: string, currentPath: string): boolean => {
  const childName = getImmediateChildName(objectKey, currentPath)
  if (!childName) return false
  const prefix = getDirectoryPrefix(currentPath)
  return objectKey === `${prefix}${childName}`
}

const normalizeObjectList = (data: unknown): ObsObjectRow[] => {
  const source = isRecord(data) ? (data.objects ?? data.items ?? data.data ?? data.results) : data
  if (!Array.isArray(source)) return []
  return source.map(normalizeObject).filter((item) => item.key && item.key !== '-')
}

const normalizeDirectoryListing = (data: unknown, requestedPrefix: string): ObsDirectoryListing => {
  const record = isRecord(data) ? data : {}
  const currentPath = normalizeDirectoryPath(record.prefix ?? record.currentPrefix ?? record.path ?? requestedPrefix)
  const allObjects = normalizeObjectList(data)
  const folderMap = new Map<string, ObsFolderRow>()

  const explicitFolders = Array.isArray(record.folders) ? record.folders : Array.isArray(record.prefixes) ? record.prefixes : []
  explicitFolders.forEach((value) => {
    const folder = normalizeFolder(value, currentPath)
    if (folder) folderMap.set(folder.prefix, folder)
  })

  allObjects.forEach((object) => {
    const childName = getImmediateChildName(object.key, currentPath)
    if (!childName || isObjectInCurrentDirectory(object.key, currentPath)) return
    const childPath = joinDirectoryPath(currentPath, childName)
    if (!folderMap.has(childPath)) {
      folderMap.set(childPath, {
        key: childPath,
        name: childName,
        prefix: childPath,
      })
    }
  })

  const folders = Array.from(folderMap.values())
    .filter((folder) => getParentDirectoryPath(folder.prefix) === currentPath)
    .sort((left, right) => left.name.localeCompare(right.name))

  const objects = allObjects
    .filter((object) => isObjectInCurrentDirectory(object.key, currentPath))
    .sort((left, right) => left.name.localeCompare(right.name))

  return { prefix: currentPath, folders, objects }
}

const normalizeObjectDetail = (data: unknown, fallback: ObsObjectRow): ObsObjectDetail => {
  const item = normalizeObject(isRecord(data) ? (data.object ?? data.data ?? data) : data)
  const record = isRecord(data) ? data : {}

  return {
    ...fallback,
    ...item,
    key: item.key && item.key !== '-' ? item.key : fallback.key,
    bucket: stringifyValue(record.bucket),
    url: stringifyValue(record.url ?? record.downloadUrl ?? record.download_url),
    metadata: Object.keys(item.metadata).length > 0 ? item.metadata : fallback.metadata,
  }
}

const formatFileSize = (size: number | null): string => {
  if (size === null) return '-'
  if (size < 1024) return `${size} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = size / 1024
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[index]}`
}

const formatFriendlyDateTime = (value: string): string => {
  const normalized = value.trim()
  if (!normalized || normalized === '-') return '-'

  const parsed = new Date(normalized)
  if (Number.isNaN(parsed.getTime())) return value

  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(parsed).replaceAll('/', '-')
}

const encodeObsObjectKey = (key: string): string => key.split('/').map((segment) => encodeURIComponent(segment)).join('/')

const buildObsObjectUrl = (bucket: string, key?: string, prefix?: string): string => {
  const params = new URLSearchParams({ bucket })
  const normalizedPrefix = normalizeDirectoryPath(prefix)
  if (normalizedPrefix) params.set('prefix', getDirectoryPrefix(normalizedPrefix))
  if (!key) return `/obs/objects?${params.toString()}`
  return `/obs/objects/${encodeObsObjectKey(key)}?${params.toString()}`
}

const isImageObject = (object: ObsObjectRow | ObsObjectDetail | null): boolean => {
  if (!object) return false
  const contentType = object.contentType.trim().toLowerCase()
  if (contentType.startsWith('image/')) return true

  const extension = object.key.split(/[?#]/)[0]?.split('.').pop()?.toLowerCase() ?? ''
  return IMAGE_FILE_EXTENSIONS.has(extension)
}

const buildObsObjectContentUrl = (bucket: string, key: string): string => {
  const params = new URLSearchParams({ bucket })
  return `/obs/object-content/${encodeObsObjectKey(key)}?${params.toString()}`
}

export const ObsManagerModal: FC<ObsManagerModalProps> = ({ open, onCancel }) => {
  const { notification } = AntdApp.useApp()
  const [uploadForm] = Form.useForm<ObsUploadFormValues>()
  const [bucket, setBucket] = useState(DEFAULT_BUCKET)
  const [currentPath, setCurrentPath] = useState('')
  const [filterText, setFilterText] = useState('')
  const [selectedObjectKey, setSelectedObjectKey] = useState('')
  const [uploadFileList, setUploadFileList] = useState<UploadFile[]>([])
  const uploadKeyTouchedRef = useRef(false)

  const normalizedBucket = bucket.trim() || DEFAULT_BUCKET

  const listRequest = useRequest(
    async (targetBucket: string, prefix: string) => {
      const response = await fetch(buildObsObjectUrl(targetBucket, undefined, prefix))
      return normalizeDirectoryListing(await parseJsonResponse<unknown>(response), prefix)
    },
    { manual: true },
  )

  const detailRequest = useRequest(
    async (targetBucket: string, object: ObsObjectRow) => {
      const response = await fetch(buildObsObjectUrl(targetBucket, object.key))
      return normalizeObjectDetail(await parseJsonResponse<unknown>(response), object)
    },
    { manual: true },
  )

  const uploadRequest = useRequest(
    async (targetBucket: string, objectKey: string, file: File) => {
      const params = new URLSearchParams({ bucket: targetBucket })
      const formData = new FormData()
      formData.append('objectKey', objectKey)
      formData.append('file', file)

      const response = await fetch(`/obs/objects?${params.toString()}`, {
        method: 'POST',
        body: formData,
      })
      await parseJsonResponse<unknown>(response)
    },
    { manual: true },
  )

  const deleteRequest = useRequest(
    async (targetBucket: string, objectKey: string) => {
      const response = await fetch(buildObsObjectUrl(targetBucket, objectKey), { method: 'DELETE' })
      await parseJsonResponse<unknown>(response)
    },
    { manual: true },
  )

  const selectedObject = useMemo(
    () => listRequest.data?.objects.find((item) => item.key === selectedObjectKey) ?? null,
    [listRequest.data, selectedObjectKey],
  )

  const browserEntries = useMemo<ObsBrowserEntry[]>(() => {
    const query = filterText.trim().toLowerCase()
    const listing = listRequest.data ?? { prefix: currentPath, folders: [], objects: [] }
    const entries: ObsBrowserEntry[] = [
      ...listing.folders.map((folder) => ({ ...folder, entryType: 'folder' as const })),
      ...listing.objects.map((object) => ({ ...object, entryType: 'object' as const })),
    ]
    if (!query) return entries
    return entries.filter((item) => {
      if (item.entryType === 'folder') return [item.prefix, item.name, 'folder'].join(' ').toLowerCase().includes(query)
      return [item.key, item.name, item.contentType].join(' ').toLowerCase().includes(query)
    })
  }, [currentPath, filterText, listRequest.data])

  const currentDirectoryPath = listRequest.data?.prefix ?? currentPath

  const navigateDirectory = useMemoizedFn((targetPath: string) => {
    setCurrentPath(normalizeDirectoryPath(targetPath))
    setFilterText('')
    setSelectedObjectKey('')
    detailRequest.mutate(undefined)
  })

  const pathSegments = useMemo(() => currentDirectoryPath.split('/').filter(Boolean), [currentDirectoryPath])

  const breadcrumbItems = useMemo(
    () => [
      {
        title: (
          <button type="button" className="cursor-pointer border-0 bg-transparent p-0" onClick={() => navigateDirectory('')}>
            <Space size={4}>
              <HomeOutlined />
              <span>根目录</span>
            </Space>
          </button>
        ),
      },
      ...pathSegments.map((segment, index) => {
        const targetPath = pathSegments.slice(0, index + 1).join('/')
        return {
          title: (
            <button type="button" className="cursor-pointer border-0 bg-transparent p-0" onClick={() => navigateDirectory(targetPath)}>
              {segment}
            </button>
          ),
        }
      }),
    ],
    [navigateDirectory, pathSegments],
  )

  const metadataEntries = useMemo(() => {
    const metadata = detailRequest.data?.metadata ?? selectedObject?.metadata ?? {}
    return Object.entries(metadata)
  }, [detailRequest.data?.metadata, selectedObject?.metadata])

  const refreshObjects = useMemoizedFn(async () => {
    try {
      const listing = await listRequest.runAsync(normalizedBucket, currentPath)
      if (selectedObjectKey && !listing.objects.some((item) => item.key === selectedObjectKey)) {
        setSelectedObjectKey('')
        detailRequest.mutate(undefined)
      }
    } catch {
      // The Alert bound to listRequest.error renders the actionable failure state.
    }
  })

  useEffect(() => {
    if (!open) return
    void refreshObjects()
  }, [currentPath, open, refreshObjects])

  const handleOpenChange = useMemoizedFn((nextOpen: boolean) => {
    if (nextOpen) return
    setFilterText('')
    setCurrentPath('')
    setSelectedObjectKey('')
    setUploadFileList([])
    uploadKeyTouchedRef.current = false
    detailRequest.mutate(undefined)
    uploadForm.resetFields()
  })

  const handleSelectObject = useMemoizedFn((object: ObsObjectRow) => {
    setSelectedObjectKey(object.key)
    uploadKeyTouchedRef.current = true
    uploadForm.setFieldValue('objectKey', object.key)
    void detailRequest.runAsync(normalizedBucket, object).catch(() => {
      // The detail panel keeps the selected row visible and renders detailRequest.error.
    })
  })

  const handleEnterFolder = useMemoizedFn((folder: ObsFolderRow) => {
    navigateDirectory(folder.prefix)
  })

  const handleUpload = useMemoizedFn(async () => {
    const file = uploadFileList[0]?.originFileObj
    if (!file) {
      notification.error({ message: '请选择上传文件', description: '拖拽或点击选择一个文件后再上传。', placement: 'topRight' })
      return
    }

    const values = await uploadForm.validateFields()
    const objectKey = values.objectKey.trim()
    try {
      await uploadRequest.runAsync(normalizedBucket, objectKey, file)
      notification.success({ message: 'OBS 对象已上传', description: `已写入 ${normalizedBucket}/${objectKey}`, placement: 'topRight' })
      setUploadFileList([])
      uploadKeyTouchedRef.current = false
      const listing = await listRequest.runAsync(normalizedBucket, currentPath)
      const uploadedObject = listing.objects.find((item) => item.key === objectKey)
      if (uploadedObject) {
        setSelectedObjectKey(objectKey)
        void detailRequest.runAsync(normalizedBucket, uploadedObject).catch(() => {
          // The detail panel keeps the refreshed row selected and shows the error state if metadata loading fails.
        })
      } else {
        setSelectedObjectKey('')
        detailRequest.mutate(undefined)
      }
    } catch {
      // The upload Alert bound to uploadRequest.error renders the actionable failure state.
    }
  })

  const handleDelete = useMemoizedFn(async (objectKey: string) => {
    try {
      await deleteRequest.runAsync(normalizedBucket, objectKey)
      notification.success({ message: 'OBS 对象已删除', description: objectKey, placement: 'topRight' })
      if (selectedObjectKey === objectKey) {
        setSelectedObjectKey('')
        detailRequest.mutate(undefined)
      }
      await refreshObjects()
    } catch {
      // Delete errors are kept in deleteRequest.error and surfaced beside the object list.
    }
  })

  const columns: TableColumnsType<ObsBrowserEntry> = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'key',
      width: '100%',
      render: (value: string, record) => (
        <button
          type="button"
          className="w-full min-w-0 cursor-pointer border-0 bg-transparent p-0 text-left"
          onClick={() => (record.entryType === 'folder' ? handleEnterFolder(record) : handleSelectObject(record))}
        >
          <Space size={8} className="flex max-w-full items-center">
            {record.entryType === 'folder' ? (
              <FolderOutlined className="text-[rgba(56,189,248,0.92)]" />
            ) : (
              <FileOutlined className="text-[rgba(148,163,184,0.88)]" />
            )}
            <Text className="min-w-0 flex-1 text-[13px]" ellipsis={{ tooltip: record.entryType === 'folder' ? value : record.key }}>
              {record.entryType === 'folder' ? value : record.name}
            </Text>
          </Space>
        </button>
      ),
    },
    {
      title: '大小',
      dataIndex: 'size',
      key: 'size',
      width: 120,
      render: (value: number | null, record) => <Text type="secondary">{record.entryType === 'folder' ? '-' : formatFileSize(value)}</Text>,
    },
    {
      title: '更新时间',
      dataIndex: 'lastModified',
      key: 'lastModified',
      width: 168,
      render: (value: string, record) => (
        <Text type="secondary" className="whitespace-nowrap text-[12px]">
          {record.entryType === 'folder' ? '文件夹' : formatFriendlyDateTime(value)}
        </Text>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 88,
      render: (_, record) => record.entryType === 'folder' ? (
        <Button size="small" icon={<FolderOpenOutlined />} onClick={() => handleEnterFolder(record)}>
          打开
        </Button>
      ) : (
        <Popconfirm
          title="确认删除此 OBS 对象？"
          description={record.key}
          okText="删除"
          cancelText="取消"
          okButtonProps={{ danger: true, loading: deleteRequest.loading }}
          onConfirm={() => handleDelete(record.key)}
        >
          <Button danger size="small" icon={<DeleteOutlined />} loading={deleteRequest.loading && selectedObjectKey === record.key}>
            删除
          </Button>
        </Popconfirm>
      ),
    },
  ]

  const currentDetail = detailRequest.data ?? selectedObject
  const detailUrl = currentDetail && 'url' in currentDetail && typeof currentDetail.url === 'string' ? currentDetail.url : ''
  const imagePreviewSrc = currentDetail && isImageObject(currentDetail)
    ? detailUrl && detailUrl !== '-'
      ? detailUrl
      : buildObsObjectContentUrl(normalizedBucket, currentDetail.key)
    : ''

  return (
    <Modal
      title="OBS 管理"
      open={open}
      onCancel={onCancel}
      afterOpenChange={handleOpenChange}
      footer={null}
      destroyOnHidden
      width={1180}
      styles={{ body: { paddingTop: 12 } }}
    >
      <Space className="w-full" direction="vertical" size="middle">
        <div className="rounded-[14px] border border-[rgba(100,116,139,0.24)] bg-[rgba(15,23,42,0.52)] p-4">
          <div className="flex items-start justify-between gap-4 max-md:flex-col">
            <div className="min-w-0 flex-1">
              <Space size={8} wrap>
                <CloudUploadOutlined className="text-[18px] text-[rgba(56,189,248,0.92)]" />
                <Text strong>对象存储工作台</Text>
                <Tag color="cyan">Bucket：{normalizedBucket}</Tag>
              </Space>
              <Paragraph className="!mb-0 !mt-2 text-[13px]" type="secondary">
                从 Ctrl+P 打开的轻量 OBS 控制台，可按逻辑目录浏览对象、检查元数据、覆盖上传与删除文件。
              </Paragraph>
            </div>
            <Space.Compact className="w-[360px] max-md:w-full">
              <Input value={bucket} onChange={(event) => setBucket(event.target.value)} placeholder="Bucket" />
              <Button icon={<ReloadOutlined />} loading={listRequest.loading} onClick={() => void refreshObjects()}>
                刷新
              </Button>
            </Space.Compact>
          </div>
        </div>

        {listRequest.error ? (
          <Alert
            type="error"
            showIcon
            title="OBS 对象列表加载失败"
            description={listRequest.error instanceof Error ? listRequest.error.message : '请稍后重试。'}
          />
        ) : null}

        {uploadRequest.error ? (
          <Alert
            type="error"
            showIcon
            title="上传失败"
            description={uploadRequest.error instanceof Error ? uploadRequest.error.message : '请稍后重试。'}
          />
        ) : null}

        {deleteRequest.error ? (
          <Alert
            type="error"
            showIcon
            title="删除失败"
            description={deleteRequest.error instanceof Error ? deleteRequest.error.message : '请稍后重试。'}
          />
        ) : null}

        <div className="grid grid-cols-[minmax(0,1fr)_360px] items-start gap-4 max-[980px]:grid-cols-1">
          <div className="min-w-0 rounded-[12px] border border-[rgba(100,116,139,0.24)] bg-[rgba(15,23,42,0.4)] p-3">
            <Space className="mb-3 w-full" direction="vertical" size="small">
              <div className="flex items-center justify-between gap-3 max-md:flex-col max-md:items-stretch">
                <Text strong>对象浏览器</Text>
                <Input
                  allowClear
                  className="w-[320px] max-md:w-full"
                  prefix={<SearchOutlined />}
                  placeholder="按 key / 文件名 / 类型过滤"
                  value={filterText}
                  onChange={(event) => setFilterText(event.target.value)}
                />
              </div>
              <div className="rounded-[10px] border border-[rgba(100,116,139,0.24)] bg-[rgba(2,6,23,0.34)] px-3 py-2">
                <div className="flex items-center justify-between gap-3 max-md:flex-col max-md:items-start">
                  <Breadcrumb items={breadcrumbItems} />
                  <Button size="small" icon={<ReloadOutlined />} loading={listRequest.loading} onClick={() => void refreshObjects()}>
                    刷新当前目录
                  </Button>
                </div>
              </div>
              <Text type="secondary" className="text-[12px]">
                当前目录显示 {browserEntries.length} 个匹配项；点击文件夹进入，点击对象查看详情并可作为覆盖上传目标。
              </Text>
            </Space>

            <Table<ObsBrowserEntry>
              columns={columns}
              dataSource={browserEntries}
              loading={listRequest.loading}
              pagination={{ pageSize: 8, size: 'small', showSizeChanger: false }}
              rowKey={(record) => `${record.entryType}:${record.key}`}
              rowClassName={(record) => (record.entryType === 'object' && record.key === selectedObjectKey ? 'ant-table-row-selected' : '')}
              locale={{ emptyText: <Empty description="当前目录暂无文件夹、对象或过滤结果为空。" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
              size="small"
              tableLayout="fixed"
              scroll={{ x: 720 }}
            />
          </div>

          <div className="flex min-w-0 max-h-[70vh] flex-col gap-4 overflow-y-auto pr-1">
            <div className="rounded-[12px] border border-[rgba(100,116,139,0.24)] bg-[rgba(15,23,42,0.4)] p-4">
              <Space className="w-full" direction="vertical" size="middle">
                <div className="flex items-center justify-between gap-3">
                  <Space size={8}>
                    <FileSearchOutlined />
                    <Text strong>对象详情</Text>
                  </Space>
                  {detailRequest.loading ? <Tag color="processing">读取中</Tag> : null}
                </div>

                {detailRequest.error ? (
                  <Alert
                    type="error"
                    showIcon
                    title="元数据读取失败"
                    description={detailRequest.error instanceof Error ? detailRequest.error.message : '请稍后重试。'}
                  />
                ) : null}

                {currentDetail ? (
                  <>
                    {imagePreviewSrc ? (
                      <div className="overflow-hidden rounded-[12px] border border-[rgba(56,189,248,0.22)] bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.12),rgba(2,6,23,0.72)_58%)] p-3 shadow-[0_18px_42px_rgba(2,6,23,0.22)]">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <div>
                            <Text strong className="text-[13px]">图片预览</Text>
                            <div className="mt-1">
                              <Text type="secondary" className="text-[12px]">点击图片可使用 Ant Design 预览层放大查看。</Text>
                            </div>
                          </div>
                          <Tag color="cyan">Image</Tag>
                        </div>
                        <div className="flex min-h-[190px] items-center justify-center rounded-[10px] border border-[rgba(148,163,184,0.18)] bg-[rgba(2,6,23,0.48)] p-3">
                          <Image
                            alt={currentDetail.name || currentDetail.key}
                            className="max-h-[220px] rounded-[8px] object-contain"
                            src={imagePreviewSrc}
                            preview={{
                              src: imagePreviewSrc,
                              rootClassName: 'obs-manager-image-preview',
                            }}
                            fallback="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='320' height='180' viewBox='0 0 320 180'><rect width='320' height='180' fill='%230f172a'/><text x='160' y='88' fill='%2394a3b8' font-family='sans-serif' font-size='14' text-anchor='middle'>图片加载失败</text><text x='160' y='112' fill='%2364748b' font-family='sans-serif' font-size='12' text-anchor='middle'>请检查对象访问权限或内容路由</text></svg>"
                            style={{ maxWidth: '100%' }}
                          />
                        </div>
                      </div>
                    ) : null}

                    <Descriptions
                      column={1}
                      size="small"
                      bordered
                      items={[
                        { key: 'key', label: 'Key', children: currentDetail.key },
                        { key: 'size', label: '大小', children: formatFileSize(currentDetail.size) },
                        { key: 'contentType', label: '类型', children: currentDetail.contentType },
                        { key: 'etag', label: 'ETag', children: currentDetail.etag },
                        {
                          key: 'lastModified',
                          label: '更新时间',
                          children: formatFriendlyDateTime(currentDetail.lastModified),
                        },
                      ]}
                    />

                    {metadataEntries.length > 0 ? (
                      <div className="flex flex-col gap-2">
                        <Text strong className="text-[13px]">Metadata</Text>
                        <div className="max-h-[150px] overflow-auto rounded-[10px] border border-[rgba(100,116,139,0.24)] bg-[rgba(2,6,23,0.5)] p-3">
                          {metadataEntries.map(([key, value]) => (
                            <div key={key} className="flex justify-between gap-3 border-b border-[rgba(100,116,139,0.14)] py-1 last:border-b-0">
                              <Text type="secondary" className="text-[12px]">{key}</Text>
                              <Text className="text-right text-[12px]">{stringifyValue(value)}</Text>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <Empty description="从左侧选择一个对象查看元数据。" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                )}
              </Space>
            </div>

            <div className="rounded-[12px] border border-[rgba(100,116,139,0.24)] bg-[rgba(15,23,42,0.4)] p-4">
              <Space className="w-full" direction="vertical" size="middle">
                <div>
                  <Text strong>上传 / 覆盖对象</Text>
                  <div className="mt-1">
                    <Text type="secondary" className="text-[12px]">
                      选择已存在对象会自动填入 Key；也可以输入新 Key 创建对象。
                    </Text>
                  </div>
                </div>

                <Form<ObsUploadFormValues> form={uploadForm} layout="vertical">
                  <Form.Item label="对象 Key" name="objectKey" rules={[{ required: true, message: '请输入对象 Key' }]}> 
                    <Input
                      placeholder={currentDirectoryPath ? `例如：${currentDirectoryPath}/app.log` : '例如：folder/app.log'}
                      onChange={() => {
                        uploadKeyTouchedRef.current = true
                      }}
                    />
                  </Form.Item>

                  <Dragger
                    maxCount={1}
                    fileList={uploadFileList}
                    beforeUpload={() => false}
                    onChange={(info) => {
                      const nextFileList = info.fileList.slice(-1)
                      setUploadFileList(nextFileList)

                      const nextFile = nextFileList[0]?.originFileObj
                      if (!nextFile || uploadKeyTouchedRef.current) return

                      const nextObjectKey = currentDirectoryPath
                        ? `${currentDirectoryPath}/${nextFile.name}`
                        : nextFile.name
                      uploadForm.setFieldValue('objectKey', nextObjectKey)
                    }}
                    disabled={uploadRequest.loading}
                  >
                    <p className="ant-upload-drag-icon"><CloudUploadOutlined /></p>
                    <p className="ant-upload-text">点击或拖拽文件到此处</p>
                    <p className="ant-upload-hint">同名 Key 会按覆盖上传处理。</p>
                  </Dragger>
                </Form>

                <Button
                  block
                  type="primary"
                  icon={<CloudUploadOutlined />}
                  loading={uploadRequest.loading}
                  disabled={uploadFileList.length === 0}
                  onClick={() => void handleUpload()}
                >
                  上传到 {normalizedBucket}
                </Button>
              </Space>
            </div>
          </div>
        </div>
      </Space>
    </Modal>
  )
}
