/** Shared Node/Express example; host authentication is an explicit integration point. */
export function tokenEndpointSnippet(route: '/convokit/token' | '/api/convokit/token') {
  return `// app is your existing Express app.
// Supply middleware that verifies your product session and sets req.user.
// For cookie sessions, also enforce your product's CSRF protection.
import { requireProductUser } from './your-auth.js'

const clientId = process.env.CONVOKIT_CLIENT_ID
const clientSecret = process.env.CONVOKIT_CLIENT_SECRET
if (!clientId || !clientSecret) throw new Error('Configure ConvoKit server credentials')

async function callConvoKit(path, body) {
  const response = await fetch('https://api.convokit.app/api/v1/' + path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-client-id': clientId,
      'x-client-secret': clientSecret,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error('ConvoKit request failed')
  return response.json()
}

app.post('${route}', requireProductUser, async (req, res) => {
  res.set('Cache-Control', 'no-store')
  const id = req.user?.id // Trusted session identity, NEVER a request-body ID.
  if (typeof id !== 'string' || !id) {
    return res.status(401).json({ error: 'Sign in first' })
  }
  if (req.body?.appUserId !== undefined && req.body.appUserId !== id) {
    return res.status(403).json({ error: 'User does not match your session' })
  }

  try {
    await callConvoKit('user', { id, name: req.user.name })
    const result = await callConvoKit('auth/token', { appUserId: id })
    if (typeof result?.data?.token !== 'string' || !result.data.token) {
      throw new Error('Invalid token response')
    }
    // The customer-facing endpoint returns { token }, not ConvoKit's envelope.
    return res.json({ token: result.data.token })
  } catch {
    return res.status(502).json({ error: 'Chat token temporarily unavailable' })
  }
})`
}
