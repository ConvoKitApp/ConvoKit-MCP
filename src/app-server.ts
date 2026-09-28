import { ConvoKitError, ConvoKitServerClient } from '@convokitapp/sdk'
import { McpServer, type CallToolResult } from '@modelcontextprotocol/server'
import * as z from 'zod/v4'
import { failure, result } from './results.js'

export interface AppCredentials {
  clientId: string
  clientSecret: string
  backendUrl?: string
}

const id = z.string().trim().min(1).max(200)
const nullableText = z.string().max(2000).nullable().optional()
const imageUrl = z.url().refine(url => ['https:', 'http:'].includes(new URL(url).protocol)).nullable().optional()
const userFields = { name: nullableText, imageUrl }
const conversationFields = { title: nullableText, description: nullableText, imageUrl }
const hasChanges = (value: object) => Object.values(value).some(field => field !== undefined)

export function createAppSdkClient(credentials: AppCredentials): ConvoKitServerClient {
  return new ConvoKitServerClient({
    ...credentials,
    fetch: (input, init) => globalThis.fetch(input, {
      ...init,
      // Custom x-client-secret headers survive some redirects. Never follow a
      // redirect with server credentials; bound calls also prevent hung tools.
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    }),
  })
}

export function createAppServer(credentials: AppCredentials, client = createAppSdkClient(credentials)): McpServer {
  const server = new McpServer({ name: 'convokit-app', version: '0.1.0' }, {
    instructions: 'Manage the single ConvoKit app configured for this connection. All operations use the official server SDK and existing API authorization. Tools cannot switch apps or change the API endpoint. App secrets are never returned. User tokens are sensitive, short lived app-user credentials. Deletion tools are destructive.',
  })

  async function execute(operation: () => Promise<unknown>): Promise<CallToolResult> {
    try {
      return result({ data: await operation() })
    } catch (error) {
      // API response bodies and exception messages can contain customer data or
      // echoed credentials. Return the SDK status/code, never the raw exception.
      if (error instanceof ConvoKitError) {
        const code = error.code && /^[A-Z0-9_]{1,80}$/.test(error.code) && !error.code.includes(credentials.clientSecret)
          ? error.code : 'API_ERROR'
        return failure(`ConvoKit operation failed (status: ${error.status ?? 'unavailable'}, code: ${code}).`)
      }
      return failure('ConvoKit operation failed. Check the server configuration and API availability.')
    }
  }
  const write = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  const remove = { ...write, destructiveHint: true, idempotentHint: true }

  server.registerTool('get_app_connection', {
    description: 'Show the configured public app ID and API endpoint. Does not reveal the app secret or MCP access token.',
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, () => result({ clientId: client.clientId, backendUrl: client.backendUrl }))

  server.registerTool('upsert_user', {
    description: 'Create or update an app user with a stable product user ID. Use before issuing a user token.',
    inputSchema: z.object({ id, ...userFields }), annotations: { ...write, idempotentHint: true },
  }, input => execute(() => client.upsertUser(input)))

  server.registerTool('update_user', {
    description: 'Update an existing app user’s name or avatar. Null clears a field.',
    inputSchema: z.object({ id, ...userFields }).refine(({ id: _id, ...changes }) => hasChanges(changes), 'Provide a name or imageUrl change.'), annotations: { ...write, idempotentHint: true },
  }, ({ id: userId, ...changes }) => execute(() => client.updateUser(userId, changes)))

  server.registerTool('delete_user', {
    description: 'Permanently delete an app user and their associated data according to the backend’s deletion policy.',
    inputSchema: z.object({ id }), annotations: remove,
  }, ({ id: userId }) => execute(() => client.deleteUser(userId)))

  server.registerTool('issue_user_token', {
    description: 'Issue a scoped token for an existing app user. Returns a sensitive, short lived user JWT and expiresIn. Use only for an authorized integration or test user.',
    inputSchema: z.object({ appUserId: id }), annotations: write,
  }, ({ appUserId }) => execute(() => client.issueUserToken(appUserId)))

  server.registerTool('update_conversation', {
    description: 'Update conversation metadata. Null clears a field.',
    inputSchema: z.object({ conversationId: id, ...conversationFields }).refine(({ conversationId: _id, ...changes }) => hasChanges(changes), 'Provide a metadata change.'), annotations: { ...write, idempotentHint: true },
  }, ({ conversationId, ...changes }) => execute(() => client.updateConversation(conversationId, changes)))

  server.registerTool('delete_conversation', {
    description: 'Permanently delete a conversation and its messages.',
    inputSchema: z.object({ conversationId: id }), annotations: remove,
  }, ({ conversationId }) => execute(() => client.deleteConversation(conversationId)))

  server.registerTool('add_conversation_member', {
    description: 'Add an existing app user to a conversation with READ or READ_WRITE permissions. The API enforces app ownership.',
    inputSchema: z.object({ conversationId: id, appUserId: id, role: z.enum(['READ', 'READ_WRITE']).optional() }), annotations: write,
  }, ({ conversationId, ...member }) => execute(() => client.addConversationMember(conversationId, member)))

  server.registerTool('remove_conversation_member', {
    description: 'Remove an app user from a conversation, revoking their membership.',
    inputSchema: z.object({ conversationId: id, appUserId: id }), annotations: { ...remove, idempotentHint: false },
  }, ({ conversationId, appUserId }) => execute(() => client.removeConversationMember(conversationId, appUserId)))

  server.registerTool('update_message', {
    description: 'Administratively replace message text. Pass revision to reject an edit if the message has changed (HTTP 409).',
    inputSchema: z.object({ messageId: id, text: z.string().max(16000), revision: z.number().int().min(0).max(2147483647).optional() }), annotations: write,
  }, ({ messageId, ...changes }) => execute(() => client.updateMessage(messageId, changes)))

  server.registerTool('delete_message', {
    description: 'Permanently delete a message.',
    inputSchema: z.object({ messageId: id }), annotations: remove,
  }, ({ messageId }) => execute(() => client.deleteMessage(messageId)))

  return server
}
