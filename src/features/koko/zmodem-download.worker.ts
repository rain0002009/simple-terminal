/// <reference lib="webworker" />

import type {
  ZmodemDownloadWorkerRequest,
  ZmodemDownloadWorkerResponse,
} from './zmodemDownloadWorker'

type DownloadAssemblyState = {
  chunks: ArrayBuffer[]
  totalBytes: number
}

const transferStore = new Map<string, DownloadAssemblyState>()

const getOrCreateState = (transferId: string): DownloadAssemblyState => {
  const existing = transferStore.get(transferId)
  if (existing) return existing

  const created: DownloadAssemblyState = {
    chunks: [],
    totalBytes: 0,
  }
  transferStore.set(transferId, created)
  return created
}

const mergeChunks = (chunks: ArrayBuffer[], totalBytes: number): ArrayBuffer => {
  const merged = new Uint8Array(totalBytes)
  let offset = 0

  chunks.forEach((chunk) => {
    const view = new Uint8Array(chunk)
    merged.set(view, offset)
    offset += view.byteLength
  })

  return merged.buffer
}

const postWorkerMessage = (message: ZmodemDownloadWorkerResponse, transferables?: Transferable[]) => {
  self.postMessage(message, transferables ?? [])
}

self.onmessage = (event: MessageEvent<ZmodemDownloadWorkerRequest>) => {
  const message = event.data

  if (!message?.transferId) return

  if (message.type === 'reset') {
    transferStore.set(message.transferId, { chunks: [], totalBytes: 0 })
    return
  }

  if (message.type === 'append-batch') {
    const state = getOrCreateState(message.transferId)
    message.chunks.forEach((chunk) => {
      state.chunks.push(chunk)
      state.totalBytes += chunk.byteLength
    })
    return
  }

  if (message.type === 'append') {
    const state = getOrCreateState(message.transferId)
    state.chunks.push(message.chunk)
    state.totalBytes += message.chunk.byteLength
    return
  }

  if (message.type === 'abort') {
    transferStore.delete(message.transferId)
    return
  }

  if (message.type !== 'finalize') return

  try {
    const state = getOrCreateState(message.transferId)
    const buffer = mergeChunks(state.chunks, state.totalBytes)

    transferStore.delete(message.transferId)
    postWorkerMessage(
      {
        type: 'finalized',
        transferId: message.transferId,
        buffer,
        totalBytes: state.totalBytes,
      },
      [buffer],
    )
  } catch (error) {
    transferStore.delete(message.transferId)
    postWorkerMessage({
      type: 'error',
      transferId: message.transferId,
      message: error instanceof Error ? error.message : 'ZMODEM 文件合并失败',
    })
  }
}
