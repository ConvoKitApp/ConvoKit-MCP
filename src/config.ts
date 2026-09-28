import type { AppCredentials } from './app-server.js'

export interface HttpConfig {
  host: string
  port: number
  allowedHosts?: string[]
  allowedOrigins: string[]
  credentials?: AppCredentials
  appToken?: string
}

const loopback = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

export function readCredentials(env: NodeJS.ProcessEnv = process.env): AppCredentials {
  const clientId = env.CONVOKIT_CLIENT_ID?.trim()
  const clientSecret = env.CONVOKIT_CLIENT_SECRET?.trim()
  if (!clientId || !clientSecret) throw new Error('Set CONVOKIT_CLIENT_ID and CONVOKIT_CLIENT_SECRET for the app MCP server.')
  const backendUrl = env.CONVOKIT_API_URL?.trim()
  if (backendUrl) {
    let url: URL
    try { url = new URL(backendUrl) } catch { throw new Error('CONVOKIT_API_URL must be an absolute URL.') }
    if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback.has(url.hostname)))) {
      throw new Error('CONVOKIT_API_URL must use HTTPS (or HTTP on loopback) without embedded credentials, a query, or a fragment.')
    }
  }
  return { clientId, clientSecret, ...(backendUrl ? { backendUrl } : {}) }
}

export function readHttpConfig(env: NodeJS.ProcessEnv = process.env): HttpConfig {
  const host = env.HOST?.trim() || '127.0.0.1'
  const port = Number(env.PORT || 3333)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535.')
  const allowedHosts = env.CONVOKIT_MCP_ALLOWED_HOSTS?.split(',').map(value => value.trim()).filter(Boolean)
  if (!loopback.has(host) && !allowedHosts?.length) throw new Error('Set CONVOKIT_MCP_ALLOWED_HOSTS when binding beyond loopback.')
  if (allowedHosts?.some(value => value.includes('/') || value.includes('@') || value === '*')) throw new Error('CONVOKIT_MCP_ALLOWED_HOSTS must contain explicit hostnames.')
  const allowedOrigins = env.CONVOKIT_MCP_ALLOWED_ORIGINS?.split(',').map(value => value.trim()).filter(Boolean) ?? []
  for (const origin of allowedOrigins) {
    let parsed: URL
    try { parsed = new URL(origin) } catch { throw new Error('CONVOKIT_MCP_ALLOWED_ORIGINS must contain explicit HTTP or HTTPS origins.') }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) throw new Error('CONVOKIT_MCP_ALLOWED_ORIGINS must contain origins without paths or credentials.')
  }

  const appConfigured = Boolean(env.CONVOKIT_CLIENT_ID || env.CONVOKIT_CLIENT_SECRET || env.CONVOKIT_MCP_APP_TOKEN)
  if (!appConfigured) return { host, port, allowedHosts, allowedOrigins }
  const credentials = readCredentials(env)
  const appToken = env.CONVOKIT_MCP_APP_TOKEN?.trim()
  if (!appToken || appToken.length < 32 || /\s/.test(appToken) || appToken === credentials.clientSecret) {
    throw new Error('Set CONVOKIT_MCP_APP_TOKEN to a separate access token of at least 32 characters without whitespace.')
  }
  return { host, port, allowedHosts, allowedOrigins, credentials, appToken }
}
