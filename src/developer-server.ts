import { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod/v4'
import { codeExamples, findGuide, guides, integrationPlan, metadata, platformSchema, search, sections, snapshotInfo } from './corpus.js'
import { failure, result } from './results.js'

export function createDeveloperServer(): McpServer {
  const server = new McpServer({ name: 'convokit-developer', version: '0.1.0' }, {
    instructions: 'Help developers integrate ConvoKit using the bundled official documentation. Start with get_integration_plan, then fetch relevant sections and code examples. Preserve source URLs and use the documented package versions. App secrets belong on the developer’s backend; this server needs no credentials and cannot access app data.',
  })
  const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }

  server.registerTool('list_guides', {
    description: 'List official ConvoKit guides, section indexes, source URLs, and documentation snapshot date.',
    inputSchema: z.object({ platform: platformSchema.optional() }), annotations,
  }, ({ platform }) => result({
    ...snapshotInfo,
    guides: guides.filter(guide => !platform || !guide.platforms.length || guide.platforms.includes(platform)).map(guide => metadata(guide)),
  }))

  server.registerTool('search_docs', {
    description: 'Search documentation sections for SDK methods, installation, authentication, errors, API routes, and UI behavior. Use get_guide to read a returned sectionIndex.',
    inputSchema: z.object({
      query: z.string().trim().min(1).max(300), platform: platformSchema.optional(),
      limit: z.number().int().min(1).max(20).default(6),
    }), annotations,
  }, ({ query, platform, limit }) => result({ ...snapshotInfo, matches: search(query, platform, limit) }))

  server.registerTool('get_guide', {
    description: 'Get a guide’s section index and introductory section, or read a specific section by sectionIndex. Full guides are also available as MCP resources.',
    inputSchema: z.object({ guideId: z.string().min(1).max(80), sectionIndex: z.number().int().min(0).optional() }), annotations,
  }, ({ guideId, sectionIndex }) => {
    const guide = findGuide(guideId)
    if (!guide) return failure('Unknown guide. Use list_guides to find a guideId.')
    const section = sections(guide)[sectionIndex ?? 0]
    if (!section) return failure('Unknown sectionIndex. Use get_guide without sectionIndex to list sections.')
    return result({ ...metadata(guide, true), section })
  })

  server.registerTool('get_code_examples', {
    description: 'Return exact code examples from an official guide. Filter by topic, or paginate with offset to find installation, token providers, chat UI, realtime, or media examples.',
    inputSchema: z.object({
      guideId: z.string().min(1).max(80), topic: z.string().max(150).default(''),
      offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(10).default(3),
    }), annotations,
  }, ({ guideId, topic, offset, limit }) => {
    const guide = findGuide(guideId)
    if (!guide) return failure('Unknown guide. Use list_guides to find a guideId.')
    const examples = codeExamples(guide, topic)
    return result({ ...snapshotInfo, guideId, total: examples.length, examples: examples.slice(offset, offset + limit) })
  })

  server.registerTool('get_integration_plan', {
    description: 'Plan a ConvoKit integration for JavaScript, React, Vue, React Native, Flutter, Swift, or Android, with backend token examples and links to the exact platform guides.',
    inputSchema: z.object({ platform: platformSchema, includeUi: z.boolean().default(true) }), annotations,
  }, ({ platform, includeUi }) => result(integrationPlan(platform, includeUi)))

  for (const guide of guides) {
    server.registerResource(guide.id, `convokit://docs/${guide.id}`, {
      title: guide.title, description: guide.description, mimeType: 'text/markdown',
    }, uri => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: `Source: ${guide.url}\nSnapshot: ${snapshotInfo.generatedAt}\n\n${guide.text}` }] }))
  }

  server.registerPrompt('integrate_convokit', {
    description: 'Prepare an integration task using ConvoKit’s official platform and authentication guides.',
    argsSchema: z.object({ platform: platformSchema, goal: z.string().min(1).max(2000) }),
  }, ({ platform, goal }) => ({
    messages: [{ role: 'user', content: { type: 'text', text: [
      `Integrate ConvoKit into my ${platform} application. Goal: ${goal}`,
      JSON.stringify(integrationPlan(platform, true), null, 2),
      'Inspect the application’s existing authentication and project conventions. Use get_code_examples and get_guide for exact platform APIs. Keep app secrets on the backend and derive chat identity from the authenticated product session.',
    ].join('\n\n') } }],
  }))
  return server
}
