export const getHeaderValue = (headers, headerName) => {
  const match = Object.entries(headers).find(([name]) => name.toLowerCase() === headerName)
  const value = match?.[1]

  if (Array.isArray(value)) return String(value[0] ?? '').trim()
  return String(value ?? '').trim()
}

export const getCookieValue = (cookieHeader, cookieName) => {
  const cookies = String(cookieHeader ?? '').split(';')

  for (const cookie of cookies) {
    const [rawName, ...rawValueParts] = cookie.trim().split('=')
    if (rawName !== cookieName) continue

    try {
      return decodeURIComponent(rawValueParts.join('='))
    } catch {
      return rawValueParts.join('=')
    }
  }

  return ''
}
