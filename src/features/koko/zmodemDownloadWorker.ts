export type ZmodemDownloadWorkerRequest =
  | {
      type: 'reset'
      transferId: string
    }
  | {
      type: 'append-batch'
      transferId: string
      chunks: ArrayBuffer[]
    }
  | {
      type: 'append'
      transferId: string
      chunk: ArrayBuffer
    }
  | {
      type: 'finalize'
      transferId: string
    }
  | {
      type: 'abort'
      transferId: string
    }

export type ZmodemDownloadWorkerResponse =
  | {
      type: 'finalized'
      transferId: string
      buffer: ArrayBuffer
      totalBytes: number
    }
  | {
      type: 'error'
      transferId: string
      message: string
    }

export const isZmodemDownloadWorkerResponse = (value: unknown): value is ZmodemDownloadWorkerResponse => {
  if (!value || typeof value !== 'object') return false

  const messageType = Reflect.get(value, 'type')
  const transferId = Reflect.get(value, 'transferId')

  if (typeof messageType !== 'string' || typeof transferId !== 'string' || !transferId) {
    return false
  }

  if (messageType === 'error') {
    return typeof Reflect.get(value, 'message') === 'string'
  }

  if (messageType === 'finalized') {
    return Reflect.get(value, 'buffer') instanceof ArrayBuffer && typeof Reflect.get(value, 'totalBytes') === 'number'
  }

  return false
}
