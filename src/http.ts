import { createHash, timingSafeEqual } from 'node:crypto'
import { createMcpExpressApp } from '@modelcontextprotocol/express'
import { toNodeHandler } from '@modelcontextprotocol/node'
import { createMcpHandler } from '@modelcontextprotocol/server'
import type { ErrorRequestHandler } from 'express'
import { createAppServer } from './app-server.js'
import { createDeveloperServer } from './developer-server.js'
import type { HttpConfig } from './config.js'
import type { ConvoKitServerClient } from '@convokitapp/sdk'

export function createHttpApp(config: HttpConfig, appClient?: ConvoKitServerClient) {
  const app = createMcpExpressApp({
    host: config.host, allowedHosts: config.allowedHosts,
    // SDK origin validation accepts hostnames. The middleware below additionally
    // checks the entire origin, including scheme and port.
    ...(config.allowedOrigins.length ? { allowedOrigins: config.allowedOrigins.map(origin => new URL(origin).hostname) } : {}),
    jsonLimit: '64kb',
  })
  app.disable('x-powered-by')
  app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store')
    const origin = req.headers.origin
    if (origin && !config.allowedOrigins.includes(origin)) {
      res.status(403).json({ error: 'Origin not allowed' })
      return
    }
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Vary', 'Origin')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Accept, MCP-Protocol-Version, MCP-Session-Id')
      res.setHeader('Access-Control-Expose-Headers', 'MCP-Protocol-Version, MCP-Session-Id')
    }
    if (req.method === 'OPTIONS') { res.status(204).end(); return }
    next()
  })
  app.get('/health', (_req, res) => res.json({ status: 'ok', developer: true, app: Boolean(config.credentials && config.appToken) }))

  const developerHandler = createMcpHandler(createDeveloperServer, { legacy: 'stateless', maxRequestBodySize: 65536 })
  const developerNode = toNodeHandler(developerHandler)
  app.all('/mcp/developer', (req, res) => { void developerNode(req, res, req.body) })

  // HTTP management is disabled unless both app credentials and a distinct
  // inbound MCP token are set. The inbound token is never sent to ConvoKit.
  const appHandler = config.credentials && config.appToken
    ? createMcpHandler(() => createAppServer(config.credentials!, appClient), { legacy: 'stateless', maxRequestBodySize: 65536 })
    : undefined
  if (appHandler) {
    const appNode = toNodeHandler(appHandler)
    const expected = createHash('sha256').update(config.appToken!).digest()
    app.all('/mcp/app', (req, res) => {
      const authorization = req.headers.authorization ?? ''
      const supplied = /^Bearer ([^\s]+)$/i.exec(authorization)?.[1] ?? ''
      const received = createHash('sha256').update(supplied).digest()
      if (!supplied || !timingSafeEqual(expected, received)) {
        res.setHeader('WWW-Authenticate', 'Bearer realm="convokit-app"')
        res.status(401).json({ error: 'MCP app access token required' })
        return
      }
      void appNode(req, res, req.body)
    })
  } else {
    app.all('/mcp/app', (_req, res) => res.status(404).json({ error: 'App MCP is not configured' }))
  }
  const handleError: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    const status = typeof error === 'object' && error !== null && 'status' in error ? error.status : undefined
    res.status(status === 413 ? 413 : 400).json({ error: status === 413 ? 'Request body too large' : 'Invalid request body' })
  }
  app.use(handleError)
  return { app, close: async () => { await Promise.all([developerHandler.close(), appHandler?.close()]) } }
}
