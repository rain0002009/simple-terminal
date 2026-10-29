type ZmodemSessionType = 'send' | 'receive'

type ZmodemSession = {
  type?: ZmodemSessionType
  on(eventName: string, handler: (...args: unknown[]) => void): unknown
  start?(): Promise<unknown>
  close?(): Promise<unknown>
}

type ZmodemDetection = {
  confirm(): ZmodemSession
}

type ZmodemTransfer = {
  get_offset(): number
}

type ZmodemGlobal = {
  Sentry: new (options: {
    to_terminal: (octets: unknown) => void
    sender: (octets: unknown) => void
    on_detect: (detection: ZmodemDetection) => void
    on_retract: () => void
  }) => {
    consume(input: ArrayBuffer): void
  }
  Browser: {
    send_files(
      session: ZmodemSession,
      files: FileList | File[],
      options?: {
        on_offer_response?: (file: File, transfer?: ZmodemTransfer) => void
        on_progress?: (file: File, transfer: ZmodemTransfer, chunk: Uint8Array) => void
        on_file_complete?: (file: File, transfer: ZmodemTransfer) => void
      },
    ): Promise<void>
  }
}

declare global {
  interface Window {
    Zmodem?: ZmodemGlobal
  }
}

export {}
