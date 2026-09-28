import { test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { ConvoKitServerClient } from '@convokitapp/sdk'
import { createHttpApp } from '../dist/http.js'
import { readCredentials, readHttpConfig } from '../dist/config.js'
import { codeExamples, guides, sections } from '../dist/corpus.js'
import { fileURLToPath } from 'node:url'
import { request as httpRequest } from 'node:http'
import { createServer as createNodeServer } from 'node:http'
import { createAppSdkClient } from '../dist/app-server.js'

const credentials = { clientId: 'test-app', clientSecret: 'backend-secret', backendUrl: 'https://test.convokit.example' }
const appToken = 'mcp-access-token-distinct-and-at-least-32-characters'
const date = '2026-09-28T00:00:00.000Z'

async function start(t, { management = false, client, allowedOrigins = [] } = {}) {
  const runtime = createHttpApp({ host: '127.0.0.1', port: 3333, allowedOrigins,
    ...(management ? { credentials, appToken } : {}),
  }, client)
  const listener = runtime.app.listen(0, '127.0.0.1')
  await once(listener, 'listening')
  const base = `http://127.0.0.1:${listener.address().port}`
  const clients = []
  t.after(async () => {
    await Promise.all(clients.map(client => client.close()))
    listener.closeAllConnections()
    await new Promise(resolve => listener.close(resolve))
    await runtime.close()
  })
  return {
    base,
    async connect(endpoint = '/mcp/developer', headers = {}) {
      const client = new Client({ name: 'convokit-test', version: '1.0.0' })
      clients.push(client)
      await client.connect(new StreamableHTTPClientTransport(new URL(base + endpoint), { requestInit: { headers } }))
      return client
    },
  }
}

async function rpc(base, endpoint, method, params = {}, headers = {}) {
  const response = await fetch(base + endpoint, {
    method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  const body = await response.text()
  const event = body.split('\n').find(line => line.startsWith('data: '))
  return { response, payload: JSON.parse(event ? event.slice(6) : body) }
}

function mockBackend(handler) {
  const requests = []
  const client = new ConvoKitServerClient({ ...credentials, fetch: async (url, init) => {
    const request = { url: String(url), method: init.method, headers: new Headers(init.headers), body: init.body ? JSON.parse(init.body) : undefined }
    requests.push(request)
    const outcome = await handler(request, requests.length)
    return Response.json(outcome.body, { status: outcome.status ?? 200 })
  } })
  return { client, requests }
}

function json(toolResult) {
  assert.equal(toolResult.isError, undefined, JSON.stringify(toolResult.content))
  return toolResult.structuredContent ?? JSON.parse(toolResult.content[0].text)
}

test('developer MCP supports HTTP discovery, search, sections, examples, resources, and prompts', async t => {
  const runtime = await start(t)
  const client = await runtime.connect()
  const tools = await client.listTools()
  assert.equal(tools.tools.length, 5)
  assert.ok(tools.tools.every(tool => tool.annotations.readOnlyHint))
  assert.ok(!JSON.stringify(tools).includes('clientSecret'))
  const listed = json(await client.callTool({ name: 'list_guides', arguments: {} }))
  assert.equal(listed.guides.length, 19)
  const found = json(await client.callTool({ name: 'search_docs', arguments: { query: 'tokenProvider', platform: 'react' } }))
  assert.ok(found.matches.length)
  const match = found.matches[0]
  const guide = json(await client.callTool({ name: 'get_guide', arguments: { guideId: match.guideId, sectionIndex: match.sectionIndex } }))
  assert.ok(guide.section.text.includes('tokenProvider'))
  const examples = json(await client.callTool({ name: 'get_code_examples', arguments: { guideId: 'quickstart', topic: 'req.user' } }))
  assert.equal(examples.examples.length, 1)
  assert.ok(examples.examples[0].code.includes('requireProductUser'))
  assert.ok(examples.examples[0].code.includes('Cache-Control'))
  const resources = await client.listResources()
  assert.equal(resources.resources.length, 19)
  const auth = await client.readResource({ uri: 'convokit://docs/auth' })
  assert.ok(auth.contents[0].text.includes('verified session'))
  const prompt = await client.getPrompt({ name: 'integrate_convokit', arguments: { platform: 'flutter', goal: 'Add support chat' } })
  assert.ok(prompt.messages[0].content.text.includes('flutter-sdk'))
})

test('all platform plans reference existing guides and preserve complete code fences', async t => {
  const runtime = await start(t)
  const client = await runtime.connect()
  for (const platform of ['javascript', 'react', 'vue', 'react-native', 'flutter', 'swift', 'android']) {
    const plan = json(await client.callTool({ name: 'get_integration_plan', arguments: { platform, includeUi: false } }))
    assert.ok(plan.guides.every(guide => guides.some(source => source.id === guide.id)))
    assert.ok(plan.guides.every(guide => !guide.id.endsWith('-ui')))
    assert.ok(plan.backendExamples.some(example => example.code.includes('requireProductUser')))
  }
  for (const guide of guides) {
    for (const section of sections(guide)) {
      assert.equal((section.text.match(/^`{3,}/gm) ?? []).length % 2, 0, `${guide.id}: split code fence`)
    }
    if (guide.id.endsWith('-sdk') || guide.id.endsWith('-ui')) assert.ok(codeExamples(guide).length > 0)
  }
  const unknown = await client.callTool({ name: 'get_guide', arguments: { guideId: '../../.env' } })
  assert.equal(unknown.isError, true)
})

test('documentation export preserves the exact original backend token snippet', async () => {
  const guide = guides.find(guide => guide.id === 'quickstart')
  const example = codeExamples(guide).find(example => example.language === 'javascript')
  const source = await readFile(new URL('./fixtures/tokenEndpointSnippet.ts', import.meta.url), 'utf8')
  const text = source.match(/return `([\s\S]*?)`\s*\}/)?.[1]
  assert.ok(text, 'Token snippet fixture not found')
  assert.equal(example.code, text.replaceAll('${route}', '/convokit/token').trim())
})

test('HTTP supports the 2025 MCP initialize and tools/list exchange', async t => {
  const runtime = await start(t)
  const initialized = await rpc(runtime.base, '/mcp/developer', 'initialize', {
    protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'legacy-test', version: '1' },
  })
  assert.equal(initialized.response.status, 200)
  assert.equal(initialized.payload.result.serverInfo.name, 'convokit-developer')
  const listed = await rpc(runtime.base, '/mcp/developer', 'tools/list')
  assert.equal(listed.payload.result.tools.length, 5)
  assert.equal((await fetch(runtime.base + '/mcp/developer')).status, 405)
})

test('management is disabled by default and authenticates every request when enabled', async t => {
  const publicRuntime = await start(t)
  assert.equal((await fetch(publicRuntime.base + '/mcp/app')).status, 404)
  const { client, requests } = mockBackend(() => { throw new Error('Unexpected backend call') })
  const runtime = await start(t, { management: true, client })
  for (const headers of [{}, { Authorization: 'Bearer wrong-token' }, { Authorization: `Bearer ${credentials.clientSecret}` }, { 'x-client-secret': credentials.clientSecret }]) {
    assert.equal((await rpc(runtime.base, '/mcp/app', 'tools/list', {}, headers)).response.status, 401)
  }
  assert.equal(requests.length, 0)
  const authorized = await runtime.connect('/mcp/app', { Authorization: `Bearer ${appToken}` })
  const tools = await authorized.listTools()
  assert.equal(tools.tools.length, 11)
  assert.equal(tools.tools.find(tool => tool.name === 'delete_conversation').annotations.destructiveHint, true)
  const connection = json(await authorized.callTool({ name: 'get_app_connection', arguments: {} }))
  assert.equal(connection.clientId, credentials.clientId)
  assert.ok(!JSON.stringify(connection).includes(credentials.clientSecret))
  assert.ok(!JSON.stringify(connection).includes(appToken))
})

test('app tools use the SDK, separate MCP tokens from API credentials, and encode path IDs', async t => {
  const backend = mockBackend((request, count) => {
    if (count === 1) return { status: 409, body: { error: 'User exists' } }
    if (request.url.endsWith('/auth/token')) return { body: { data: { token: 'scoped-user-token', expiresIn: 3600 } } }
    if (request.url.includes('/members')) return { body: { conversationId: 'room/one', appUserId: 'user/one' } }
    return { body: { data: { id: 'user/one', appId: 'test-app', name: request.body.name, createdAt: date } } }
  })
  const runtime = await start(t, { management: true, client: backend.client })
  const client = await runtime.connect('/mcp/app', { Authorization: `Bearer ${appToken}` })
  const user = json(await client.callTool({ name: 'upsert_user', arguments: { id: 'user/one', name: 'Avery' } }))
  assert.equal(user.data.name, 'Avery')
  assert.equal(backend.requests[0].method, 'POST')
  assert.equal(backend.requests[1].method, 'PATCH')
  assert.ok(backend.requests[1].url.endsWith('/user/user%2Fone'))
  const token = json(await client.callTool({ name: 'issue_user_token', arguments: { appUserId: 'user/one' } }))
  assert.equal(token.data.expiresIn, 3600)
  await client.callTool({ name: 'add_conversation_member', arguments: { conversationId: 'room/one', appUserId: 'user/one', role: 'READ' } })
  assert.deepEqual(backend.requests.at(-1).body, { appUserId: 'user/one', role: 'READ' })
  await client.callTool({ name: 'remove_conversation_member', arguments: { conversationId: 'room/one', appUserId: 'user/one' } })
  assert.ok(backend.requests.at(-1).url.endsWith('/conversations/room%2Fone/members/user%2Fone'))
  for (const request of backend.requests) {
    assert.equal(request.headers.get('x-client-id'), credentials.clientId)
    assert.equal(request.headers.get('x-client-secret'), credentials.clientSecret)
    assert.equal(request.headers.get('authorization'), null)
    assert.ok(!JSON.stringify(request.body ?? {}).includes(appToken))
  }
})

test('conversation and message tools preserve backend contracts and optimistic revisions', async t => {
  const backend = mockBackend(request => {
    if (request.method === 'DELETE') return { body: request.url.includes('/conversations/') ? { id: 'target' } : { data: { id: 'target' } } }
    if (request.url.includes('/conversations/')) return { body: { updatedConversation: { id: 'target', appId: 'test-app', title: request.body.title, createdAt: date, updatedAt: date } } }
    return { body: { data: { id: 'target', conversationId: 'room', text: request.body.text, createdAt: date, revision: 4 } } }
  })
  const runtime = await start(t, { management: true, client: backend.client })
  const client = await runtime.connect('/mcp/app', { Authorization: `Bearer ${appToken}` })
  const room = json(await client.callTool({ name: 'update_conversation', arguments: { conversationId: 'target', title: 'Support', description: null } }))
  assert.equal(room.data.title, 'Support')
  const message = json(await client.callTool({ name: 'update_message', arguments: { messageId: 'target', text: 'Corrected text', revision: 3 } }))
  assert.equal(message.data.revision, 4)
  assert.equal(backend.requests.at(-1).body.revision, 3)
  for (const [name, args] of [
    ['delete_user', { id: 'target' }], ['delete_conversation', { conversationId: 'target' }], ['delete_message', { messageId: 'target' }],
  ]) {
    assert.equal(json(await client.callTool({ name, arguments: args })).data, 'target')
    assert.equal(backend.requests.at(-1).method, 'DELETE')
  }
})

test('invalid inputs never reach the API and SDK failures do not echo secrets', async t => {
  const backend = mockBackend(() => ({ status: 401, body: { error: `echoed ${credentials.clientSecret} ${appToken}`, code: credentials.clientSecret } }))
  const runtime = await start(t, { management: true, client: backend.client })
  const client = await runtime.connect('/mcp/app', { Authorization: `Bearer ${appToken}` })
  const invalid = await rpc(runtime.base, '/mcp/app', 'tools/call', { name: 'update_user', arguments: { id: 'user' } }, { Authorization: `Bearer ${appToken}` })
  assert.ok(invalid.payload.error || invalid.payload.result?.isError)
  assert.equal(backend.requests.length, 0)
  const failed = await client.callTool({ name: 'update_user', arguments: { id: 'user', name: 'Avery' } })
  assert.equal(failed.isError, true)
  assert.ok(JSON.stringify(failed).includes('401'))
  assert.ok(!JSON.stringify(failed).includes(credentials.clientSecret))
  assert.ok(!JSON.stringify(failed).includes(appToken))
})

test('HTTP rejects hostile origins, hostile hosts, malformed JSON, and oversized bodies', async t => {
  const runtime = await start(t, { allowedOrigins: ['https://client.example'] })
  assert.equal((await fetch(runtime.base + '/health', { headers: { Origin: 'https://evil.example' } })).status, 403)
  assert.equal((await fetch(runtime.base + '/health', { headers: { Origin: 'https://client.example:444' } })).status, 403)
  // Node fetch normalizes Host; use node:http to actually send the hostile value.
  const hostileStatus = await new Promise((resolve, reject) => {
    const request = httpRequest(runtime.base + '/health', { headers: { Host: 'evil.example' } }, response => {
      response.resume()
      resolve(response.statusCode)
    })
    request.on('error', reject)
    request.end()
  })
  assert.equal(hostileStatus, 403)
  const accepted = await fetch(runtime.base + '/health', { headers: { Origin: 'https://client.example' } })
  assert.equal(accepted.status, 200)
  assert.equal(accepted.headers.get('access-control-allow-origin'), 'https://client.example')
  assert.equal(accepted.headers.get('cache-control'), 'no-store')
  assert.equal((await fetch(runtime.base + '/mcp/developer', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' })).status, 400)
  assert.equal((await fetch(runtime.base + '/mcp/developer', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data: 'a'.repeat(70000) }) })).status, 413)
})

test('configuration refuses missing auth, credential reuse, and unprotected external bindings', () => {
  assert.equal(readHttpConfig({}).host, '127.0.0.1')
  assert.throws(() => readCredentials({}), /CONVOKIT_CLIENT_ID/)
  assert.throws(() => readHttpConfig({ HOST: '0.0.0.0' }), /ALLOWED_HOSTS/)
  assert.throws(() => readHttpConfig({ CONVOKIT_CLIENT_ID: 'test', CONVOKIT_CLIENT_SECRET: 'secret' }), /APP_TOKEN/)
  assert.throws(() => readHttpConfig({ CONVOKIT_CLIENT_ID: 'test', CONVOKIT_CLIENT_SECRET: appToken, CONVOKIT_MCP_APP_TOKEN: appToken }), /separate access token/)
  assert.throws(() => readCredentials({ CONVOKIT_CLIENT_ID: 'test', CONVOKIT_CLIENT_SECRET: 'secret', CONVOKIT_API_URL: 'https://user:secret@example.com' }), /embedded credentials/)
})

test('upstream redirects cannot forward app credentials to another route', async t => {
  let targetCalls = 0
  const backend = createNodeServer((request, response) => {
    if (request.url === '/capture') {
      targetCalls++
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end('{"data":{"id":"user"}}')
      return
    }
    response.writeHead(307, { location: '/capture' })
    response.end()
  })
  backend.listen(0, '127.0.0.1')
  await once(backend, 'listening')
  t.after(() => new Promise(resolve => { backend.closeAllConnections(); backend.close(resolve) }))
  const client = createAppSdkClient({ ...credentials, backendUrl: `http://127.0.0.1:${backend.address().port}` })
  await assert.rejects(client.upsertUser({ id: 'user' }), error => error.code === 'NETWORK_ERROR')
  assert.equal(targetCalls, 0)
})

test('stdio developer and app connections work from an unrelated working directory', async t => {
  for (const mode of ['developer', 'app']) {
    const client = new Client({ name: 'stdio-test', version: '1' })
    t.after(() => client.close())
    await client.connect(new StdioClientTransport({
      command: process.execPath, args: [fileURLToPath(new URL('../dist/cli.js', import.meta.url)), mode],
      cwd: '/tmp', stderr: 'pipe',
      env: mode === 'app' ? { CONVOKIT_CLIENT_ID: credentials.clientId, CONVOKIT_CLIENT_SECRET: credentials.clientSecret } : {},
    }))
    assert.equal((await client.listTools()).tools.length, mode === 'developer' ? 5 : 11)
  }
})
