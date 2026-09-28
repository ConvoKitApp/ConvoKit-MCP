import assert from 'node:assert/strict'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'

const endpoint = new URL(process.argv[2] ?? 'http://127.0.0.1:3334/mcp/developer')
const client = new Client({ name: 'convokit-release-check', version: '0.1.0' })
const json = result => {
  assert.ok(!result.isError, JSON.stringify(result.content))
  return result.structuredContent ?? JSON.parse(result.content[0].text)
}
try {
  const health = await (await fetch(new URL('/health', endpoint))).json()
  assert.equal(health.status, 'ok')
  assert.equal(health.app, false)
  await client.connect(new StreamableHTTPClientTransport(endpoint))
  const tools = (await client.listTools()).tools
  assert.equal(tools.length, 5)
  assert.ok(tools.every(tool => tool.annotations.readOnlyHint))
  const guides = json(await client.callTool({ name: 'list_guides', arguments: {} })).guides
  assert.equal(guides.length, 19)
  assert.ok(guides.some(guide => guide.id === 'mcp'))
  for (const platform of ['javascript', 'react', 'vue', 'react-native', 'flutter', 'swift', 'android']) {
    const plan = json(await client.callTool({ name: 'get_integration_plan', arguments: { platform } }))
    assert.ok(plan.guides.length > 0)
    assert.ok(plan.backendExamples.some(example => example.code.includes('requireProductUser')))
  }
  const matches = json(await client.callTool({ name: 'search_docs', arguments: { query: 'tokenProvider', platform: 'react' } })).matches
  assert.ok(matches.length)
  const section = json(await client.callTool({ name: 'get_guide', arguments: { guideId: matches[0].guideId, sectionIndex: matches[0].sectionIndex } }))
  assert.ok(section.section.text.includes('tokenProvider'))
  const examples = json(await client.callTool({ name: 'get_code_examples', arguments: { guideId: 'quickstart', topic: 'req.user' } })).examples
  assert.ok(examples[0].code.includes('Cache-Control'))
  assert.equal((await client.listResources()).resources.length, 19)
  assert.ok((await client.readResource({ uri: 'convokit://docs/auth' })).contents[0].text.includes('verified session'))
  assert.ok((await client.getPrompt({ name: 'integrate_convokit', arguments: { platform: 'react', goal: 'Add support chat' } })).messages.length)

  const legacy = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'legacy-check', version: '1' } } }) })
  assert.equal(legacy.status, 200)
  assert.ok((await legacy.text()).includes('convokit-developer'))
  assert.equal((await fetch(new URL('/mcp/app', endpoint), { method: 'POST' })).status, 404)
  const options = await fetch(endpoint, { method: 'OPTIONS', headers: { Origin: 'https://integration.example' } })
  assert.equal(options.status, 204)
  assert.equal(options.headers.get('Access-Control-Allow-Origin'), '*')
  console.log(JSON.stringify({ endpoint: endpoint.href, health, tools: tools.map(tool => tool.name), guides: guides.length, legacy: 'passed', management: 'unavailable' }, null, 2))
} finally { await client.close() }
