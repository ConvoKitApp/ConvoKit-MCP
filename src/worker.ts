import { createMcpHandler } from '@modelcontextprotocol/server'
import { createDeveloperServer } from './developer-server.js'
import { snapshotInfo } from './corpus.js'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, MCP-Protocol-Version, MCP-Session-Id',
  'Access-Control-Expose-Headers': 'MCP-Protocol-Version, MCP-Session-Id',
  'Cache-Control': 'no-store',
}

// The public deployment imports only this read-only factory. App management
// and customer credentials stay in local processes.
export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/health' && request.method === 'GET') {
      return Response.json({ status: 'ok', version: '0.1.0', release: env.RELEASE_SHA, developer: true, app: false, ...snapshotInfo }, { headers: cors })
    }
    if (url.pathname !== '/mcp/developer') return Response.json({ error: 'Not found' }, { status: 404, headers: cors })
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
    // The immutable corpus has no change events or long-lived subscriptions.
    const handler = createMcpHandler(createDeveloperServer, { legacy: 'stateless', maxRequestBodySize: 65536, maxSubscriptions: 0, keepAliveMs: 0 })
    const response = await handler.fetch(request)
    ctx.waitUntil(handler.close())
    const headers = new Headers(response.headers)
    for (const [name, value] of Object.entries(cors)) headers.set(name, value)
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
  },
} satisfies ExportedHandler<Env>
