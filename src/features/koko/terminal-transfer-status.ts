import type { ZmodemTransferState } from './types'

type TerminalStatusParams = {
  fileName: string
  message: string
  phase: ZmodemTransferState['phase']
  totalBytes: number
  transferredBytes: number
}

type TerminalStatusState = {
  lastPhase: ZmodemTransferState['phase']
  lastProgressBucket: number
}

type TerminalStatusWriterOptions = {
  prefix: 'sz' | 'rz'
  startVerb: string
  progressVerb: string
  completeVerb: string
  failVerb: string
  progressPhase: ZmodemTransferState['phase']
}

const writeInlineStatus = (
  writeTerminalText: (text: string) => void,
  prefix: string,
  text: string,
) => {
  writeTerminalText(`\r\x1b[2K[${prefix}] ${text}`)
}

export const writeTerminalTransferStatus = (
  params: TerminalStatusParams,
  state: TerminalStatusState,
  writeTerminalText: (text: string) => void,
  options: TerminalStatusWriterOptions,
) => {
  const { fileName, message, phase: nextPhase, totalBytes, transferredBytes } = params
  const fallbackFileName = options.prefix === 'sz' ? 'download.bin' : 'upload.bin'
  const safeFileName = fileName || fallbackFileName

  if (nextPhase === options.progressPhase) {
    if (state.lastPhase === 'idle') {
      writeTerminalText(`\r\n`)
      writeInlineStatus(
        writeTerminalText,
        options.prefix,
        `${options.startVerb} ${safeFileName}${totalBytes > 0 ? `（${totalBytes} bytes）` : ''}`,
      )
      state.lastPhase = nextPhase
      state.lastProgressBucket = -1
      return
    }

    if (totalBytes <= 0) return

    const progressBucket = Math.floor((Math.max(0, Math.min(transferredBytes / totalBytes, 1)) * 100) / 10)
    if (progressBucket <= state.lastProgressBucket || progressBucket < 0 || progressBucket >= 10) {
      return
    }

    state.lastProgressBucket = progressBucket
    writeInlineStatus(writeTerminalText, options.prefix, `${options.progressVerb} ${safeFileName}: ${progressBucket * 10}%`)
    state.lastPhase = nextPhase
    return
  }

  if (nextPhase === 'completed') {
    writeInlineStatus(writeTerminalText, options.prefix, `${options.completeVerb}：${safeFileName}`)
    writeTerminalText(`\r\n`)
    state.lastPhase = nextPhase
    state.lastProgressBucket = -1
    return
  }

  if (nextPhase === 'error') {
    writeInlineStatus(writeTerminalText, options.prefix, `${options.failVerb}：${message}`)
    writeTerminalText(`\r\n`)
    state.lastPhase = nextPhase
    state.lastProgressBucket = -1
  }
}
