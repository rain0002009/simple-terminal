import { safeString } from './utils'

export type RemoteEditorPayload = {
  filePath: string
  content: string
  checksum: string
}

export type RemoteEditorBridgeResult = {
  ok: boolean
  completionItems?: string[]
  completionMode?: 'single' | 'multiple' | 'none'
  op: 'read' | 'write'
  path: string
  content?: string
  checksum?: string
  error?: string
}

export type BridgeFieldName =
  | 'ok'
  | 'op'
  | 'path'
  | 'contentChunk'
  | 'checksum'
  | 'error'
  | 'phase'
  | 'completionMode'
  | 'completionItem'

const REMOTE_EDITOR_PREFIX = '__KOKO_EDITOR__:'
const REMOTE_EDITOR_BEGIN_TOKEN = 'BEGIN'
const REMOTE_EDITOR_END_TOKEN = 'END'
const REMOTE_EDITOR_CONTENT_CHUNK_SIZE = 512
const ANSI_ESCAPE_PATTERN = new RegExp(String.raw`\x1B\[[0-?]*[ -/]*[@-~]`, 'g')
const NON_PRINTABLE_BRIDGE_PATTERN = new RegExp(String.raw`[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]`, 'g')

const encodeBase64 = (value: string): string => {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return window.btoa(binary)
}

export const decodeBase64 = (value: string): string => {
  const binary = window.atob(value)
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

export const getBridgeErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error) return error.message || fallback
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = Reflect.get(error, 'message')
    if (typeof message === 'string' && message) return message
  }
  const detail = safeString(error)
  return detail && detail !== '{}' ? detail : fallback
}

export const normalizeBridgeCandidate = (value: string): string =>
  value
    .replace(ANSI_ESCAPE_PATTERN, '')
    .replace(NON_PRINTABLE_BRIDGE_PATTERN, '')
    .trim()

const encodeShellSingleQuoted = (value: string): string => `'${value.replace(/'/g, `"'"'`)}'`

const buildBridgeMarker = (requestId: string, field: BridgeFieldName, value: string): string =>
  `printf '%s%s:%s=%s\\n' ${encodeShellSingleQuoted(REMOTE_EDITOR_PREFIX)} ${encodeShellSingleQuoted(requestId)} ${encodeShellSingleQuoted(field)} ${encodeShellSingleQuoted(value)};`

const buildBridgeVariableMarker = (requestId: string, field: BridgeFieldName, variableName: string): string =>
  `printf '%s%s:%s=%s\\n' ${encodeShellSingleQuoted(REMOTE_EDITOR_PREFIX)} ${encodeShellSingleQuoted(requestId)} ${encodeShellSingleQuoted(field)} "${variableName}";`

export const buildRemoteEditorReadCommand = (filePath: string, requestId: string): string => {
  const quotedPath = encodeShellSingleQuoted(filePath)

  return [
    '__koko_editor_read() {',
    `  local __koko_path=${quotedPath};`,
    `  ${buildBridgeMarker(requestId, 'phase', REMOTE_EDITOR_BEGIN_TOKEN)}`,
    `  ${buildBridgeMarker(requestId, 'op', 'read')}`,
    `  ${buildBridgeMarker(requestId, 'path', filePath)}`,
    '  if [ ! -f "$__koko_path" ]; then',
    `    ${buildBridgeMarker(requestId, 'ok', 'false')}`,
    `    ${buildBridgeMarker(requestId, 'error', '文件不存在')}`,
    `    ${buildBridgeMarker(requestId, 'phase', REMOTE_EDITOR_END_TOKEN)}`,
    '    return;',
    '  fi;',
    '  local __koko_content="";',
    '  if ! __koko_content=$(base64 < "$__koko_path" | tr -d "\\n"); then',
    `    ${buildBridgeMarker(requestId, 'ok', 'false')}`,
    `    ${buildBridgeMarker(requestId, 'error', '读取文件失败')}`,
    `    ${buildBridgeMarker(requestId, 'phase', REMOTE_EDITOR_END_TOKEN)}`,
    '    return;',
    '  fi;',
    '  local __koko_checksum="";',
    '  if command -v sha256sum >/dev/null 2>&1; then',
    '    __koko_checksum=$(sha256sum "$__koko_path" | cut -d " " -f1);',
    '  elif command -v shasum >/dev/null 2>&1; then',
    '    __koko_checksum=$(shasum -a 256 "$__koko_path" | cut -d " " -f1);',
    '  fi;',
    `  ${buildBridgeMarker(requestId, 'ok', 'true')}`,
    `  ${buildBridgeVariableMarker(requestId, 'checksum', '$__koko_checksum')}`,
    `  local __koko_chunk_size=${REMOTE_EDITOR_CONTENT_CHUNK_SIZE};`,
    '  local __koko_offset=0;',
    '  while [ $__koko_offset -lt ${#__koko_content} ]; do',
    '    local __koko_chunk=${__koko_content:$__koko_offset:$__koko_chunk_size};',
    '    printf "%s%s:contentChunk=%s\\n" ' +
      `${encodeShellSingleQuoted(REMOTE_EDITOR_PREFIX)} ${encodeShellSingleQuoted(requestId)} "$__koko_chunk";`,
    '    __koko_offset=$((__koko_offset + __koko_chunk_size));',
    '  done;',
    `  ${buildBridgeMarker(requestId, 'phase', REMOTE_EDITOR_END_TOKEN)}`,
    '};',
    '__koko_editor_read;',
    'unset -f __koko_editor_read',
  ].join(' ')
}

export const buildRemoteEditorWriteCommand = (payload: RemoteEditorPayload, requestId: string): string => {
  const quotedPath = encodeShellSingleQuoted(payload.filePath)
  const quotedContent = encodeShellSingleQuoted(encodeBase64(payload.content))
  const quotedChecksum = encodeShellSingleQuoted(payload.checksum)

  return [
    '__koko_editor_write() {',
    `  local __koko_path=${quotedPath};`,
    `  local __koko_payload=${quotedContent};`,
    `  local __koko_checksum=${quotedChecksum};`,
    `  ${buildBridgeMarker(requestId, 'phase', REMOTE_EDITOR_BEGIN_TOKEN)}`,
    `  ${buildBridgeMarker(requestId, 'op', 'write')}`,
    `  ${buildBridgeMarker(requestId, 'path', payload.filePath)}`,
    '  if [ -n "$__koko_checksum" ] && [ -f "$__koko_path" ]; then',
    '    local __koko_current="";',
    '    if command -v sha256sum >/dev/null 2>&1; then',
    '      __koko_current=$(sha256sum "$__koko_path" | cut -d " " -f1);',
    '    elif command -v shasum >/dev/null 2>&1; then',
    '      __koko_current=$(shasum -a 256 "$__koko_path" | cut -d " " -f1);',
    '    fi;',
    '    if [ -n "$__koko_current" ] && [ "$__koko_current" != "$__koko_checksum" ]; then',
    `      ${buildBridgeMarker(requestId, 'ok', 'false')}`,
    `      ${buildBridgeMarker(requestId, 'error', '文件已被其他会话修改，请重新加载后再保存')}`,
    `      ${buildBridgeMarker(requestId, 'phase', REMOTE_EDITOR_END_TOKEN)}`,
    '      return;',
    '    fi;',
    '  fi;',
    '  if ! printf %s "$__koko_payload" | base64 -d > "$__koko_path"; then',
    `    ${buildBridgeMarker(requestId, 'ok', 'false')}`,
    `    ${buildBridgeMarker(requestId, 'error', '写入文件失败')}`,
    `    ${buildBridgeMarker(requestId, 'phase', REMOTE_EDITOR_END_TOKEN)}`,
    '    return;',
    '  fi;',
    '  local __koko_saved_checksum="";',
    '  if command -v sha256sum >/dev/null 2>&1; then',
    '    __koko_saved_checksum=$(sha256sum "$__koko_path" | cut -d " " -f1);',
    '  elif command -v shasum >/dev/null 2>&1; then',
    '    __koko_saved_checksum=$(shasum -a 256 "$__koko_path" | cut -d " " -f1);',
    '  fi;',
    `  ${buildBridgeMarker(requestId, 'ok', 'true')}`,
    `  ${buildBridgeVariableMarker(requestId, 'checksum', '$__koko_saved_checksum')}`,
    `  ${buildBridgeMarker(requestId, 'phase', REMOTE_EDITOR_END_TOKEN)}`,
    '};',
    '__koko_editor_write;',
    'unset -f __koko_editor_write',
  ].join(' ')
}

export const buildRemotePathCompletionCommand = (inputPath: string, requestId: string): string => {
  const quotedInput = encodeShellSingleQuoted(inputPath)

  return [
    '__koko_editor_complete() {',
    `  local __koko_input=${quotedInput};`,
    `  ${buildBridgeMarker(requestId, 'phase', REMOTE_EDITOR_BEGIN_TOKEN)}`,
    `  ${buildBridgeMarker(requestId, 'op', 'read')}`,
    '  local __koko_dir="";',
    '  local __koko_prefix="";',
    '  case "$__koko_input" in',
    '    */) __koko_dir="$__koko_input"; __koko_prefix="" ;;',
    '    */*) __koko_dir="${__koko_input%/*}/"; __koko_prefix="${__koko_input##*/}" ;;',
    '    *) __koko_dir="./"; __koko_prefix="$__koko_input" ;;',
    '  esac;',
    '  if [ ! -d "$__koko_dir" ]; then',
    `    ${buildBridgeMarker(requestId, 'ok', 'true')}`,
    `    ${buildBridgeMarker(requestId, 'completionMode', 'none')}`,
    `    ${buildBridgeMarker(requestId, 'phase', REMOTE_EDITOR_END_TOKEN)}`,
    '    return;',
    '  fi;',
    '  local __koko_tmp="";',
    '  if command -v mktemp >/dev/null 2>&1; then',
    '    __koko_tmp=$(mktemp);',
    '  else',
    '    __koko_tmp="/tmp/__koko_editor_complete_$$";',
    '    : > "$__koko_tmp";',
    '  fi;',
    '  local __koko_entry="";',
    '  compgen -f -- "$__koko_input" > "$__koko_tmp" 2>/dev/null;',
    '  local __koko_count=0;',
    '  local __koko_first="";',
    '  while IFS= read -r __koko_entry; do',
    '    [ -z "$__koko_entry" ] && continue;',
    '    if [ "$__koko_count" -eq 0 ]; then __koko_first="$__koko_entry"; fi;',
    '    __koko_count=$((__koko_count + 1));',
    '  done < "$__koko_tmp";',
    '  if [ "$__koko_count" -eq 0 ]; then',
    '    rm -f "$__koko_tmp";',
    `    ${buildBridgeMarker(requestId, 'ok', 'true')}`,
    `    ${buildBridgeMarker(requestId, 'completionMode', 'none')}`,
    `    ${buildBridgeMarker(requestId, 'phase', REMOTE_EDITOR_END_TOKEN)}`,
    '    return;',
    '  fi;',
    '  if [ "$__koko_count" -eq 1 ]; then',
    '    rm -f "$__koko_tmp";',
    `    ${buildBridgeMarker(requestId, 'ok', 'true')}`,
    `    ${buildBridgeMarker(requestId, 'completionMode', 'single')}`,
    '    printf "%s%s:path=%s\\n" ' +
      `${encodeShellSingleQuoted(REMOTE_EDITOR_PREFIX)} ${encodeShellSingleQuoted(requestId)} "$__koko_first";`,
    `    ${buildBridgeMarker(requestId, 'phase', REMOTE_EDITOR_END_TOKEN)}`,
    '    return;',
    '  fi;',
    `  ${buildBridgeMarker(requestId, 'ok', 'true')}`,
    `  ${buildBridgeMarker(requestId, 'completionMode', 'multiple')}`,
    '  while IFS= read -r __koko_item; do',
    '    [ -z "$__koko_item" ] && continue;',
    '    printf "%s%s:completionItem=%s\\n" ' +
      `${encodeShellSingleQuoted(REMOTE_EDITOR_PREFIX)} ${encodeShellSingleQuoted(requestId)} "$__koko_item";`,
    '  done < "$__koko_tmp";',
    '  rm -f "$__koko_tmp";',
    `  ${buildBridgeMarker(requestId, 'phase', REMOTE_EDITOR_END_TOKEN)}`,
    '};',
    '__koko_editor_complete;',
    'unset -f __koko_editor_complete',
  ].join(' ')
}

export const parseBridgeLine = (
  text: string,
): { requestId: string; field: BridgeFieldName; value: string } | null => {
  const normalized = normalizeBridgeCandidate(text)
  const startIndex = normalized.indexOf(REMOTE_EDITOR_PREFIX)
  if (startIndex < 0) return null

  const trimmed = normalized.slice(startIndex)
  const body = trimmed.slice(REMOTE_EDITOR_PREFIX.length)
  const fieldSeparator = body.indexOf(':')
  if (fieldSeparator < 0) return null

  const requestId = body.slice(0, fieldSeparator)
  const pair = body.slice(fieldSeparator + 1)
  const valueSeparator = pair.indexOf('=')
  if (!requestId || valueSeparator < 0) return null

  const field = pair.slice(0, valueSeparator) as BridgeFieldName
  const value = pair.slice(valueSeparator + 1)
  if (!field) return null

  return { requestId, field, value }
}
