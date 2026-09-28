import snapshotContent from './content/guides.json' with { type: 'json' }
import * as z from 'zod/v4'

export const platformSchema = z.enum(['javascript', 'react', 'vue', 'react-native', 'flutter', 'swift', 'android'])
export type Platform = z.infer<typeof platformSchema>

const guideSchema = z.object({
  id: z.string(), title: z.string(), description: z.string(), url: z.url(),
  platforms: z.array(platformSchema), text: z.string(), source: z.string(),
})
const snapshot = z.object({
  schemaVersion: z.literal(1), generatedAt: z.string(), sourceHash: z.string(),
  guides: z.array(guideSchema).min(1),
}).parse(snapshotContent)

export type Guide = z.infer<typeof guideSchema>
export const guides = snapshot.guides
export const snapshotInfo = { generatedAt: snapshot.generatedAt, sourceHash: snapshot.sourceHash }

export function findGuide(id: string): Guide | undefined {
  return guides.find(guide => guide.id === id)
}

export function sections(guide: Guide) {
  const lines = guide.text.split('\n')
  const headings: { title: string; start: number }[] = []
  let fence: string | undefined
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!
    const marker = /^(`{3,})/.exec(line)?.[1]
    if (marker) {
      if (!fence) fence = marker
      else if (marker.length >= fence.length) fence = undefined
      continue
    }
    if (!fence) {
      const heading = /^#{1,6}\s+(.+)/.exec(line)?.[1]
      if (heading) headings.push({ title: heading, start: index })
    }
  }
  if (!headings.length) headings.push({ title: guide.title, start: 0 })
  else headings[0]!.start = 0
  return headings.map((heading, index) => ({
    index, title: heading.title,
    text: lines.slice(heading.start, headings[index + 1]?.start ?? lines.length).join('\n').trim(),
  }))
}

export function metadata(guide: Guide, includeSections = false) {
  return {
    id: guide.id, title: guide.title, description: guide.description, url: guide.url,
    resourceUri: `convokit://docs/${guide.id}`, platforms: guide.platforms,
    ...(includeSections ? { sections: sections(guide).map(({ index, title }) => ({ index, title })) } : {}),
    ...snapshotInfo,
  }
}

export function codeExamples(guide: Guide, topic = '') {
  const pattern = /^(`{3,})([^\n]*)\n([\s\S]*?)^\1[ \t]*$/gm
  const terms = topic.toLowerCase().match(/[a-z0-9_]+/g) ?? []
  return [...guide.text.matchAll(pattern)].map((match, index) => ({
    index, language: match[2]!.trim(), code: match[3]!.replace(/\n$/, ''),
    context: guide.text.slice(Math.max(0, match.index! - 350), match.index).trim(),
    guideId: guide.id, url: guide.url,
  })).filter(example => terms.every(term => `${example.context}\n${example.code}`.toLowerCase().includes(term)))
}

export function search(query: string, platform: Platform | undefined, limit: number) {
  const terms = [...new Set(query.toLowerCase().match(/[a-z0-9_]+/g) ?? [])]
  if (!terms.length) return []
  return guides.filter(guide => !platform || !guide.platforms.length || guide.platforms.includes(platform))
    .flatMap(guide => sections(guide).map(section => {
      const body = section.text.toLowerCase()
      const title = `${guide.title} ${section.title}`.toLowerCase()
      const matches = terms.filter(term => body.includes(term) || title.includes(term))
      const score = matches.length * 10 + terms.filter(term => title.includes(term)).length * 5
      const firstMatch = Math.max(0, Math.min(...terms.map(term => body.indexOf(term)).filter(index => index >= 0)))
      const start = Number.isFinite(firstMatch) ? Math.max(0, firstMatch - 120) : 0
      return {
        guideId: guide.id, title: guide.title, sectionIndex: section.index, sectionTitle: section.title,
        url: guide.url, excerpt: section.text.slice(start, start + 1200), score,
        matchedTerms: matches.length,
      }
    }))
    .filter(match => match.matchedTerms === terms.length)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
}

const platformGuides: Record<Platform, string[]> = {
  javascript: ['javascript-sdk'], react: ['javascript-sdk', 'react-ui'], vue: ['javascript-sdk', 'vue-ui'],
  'react-native': ['react-native-sdk', 'react-native-ui'],
  flutter: ['flutter-sdk', 'flutter-ui'], swift: ['swift-sdk', 'swift-ui'], android: ['android-sdk', 'android-ui'],
}

export function integrationPlan(platform: Platform, includeUi: boolean) {
  const selectedIds = platformGuides[platform].filter(id => includeUi || !id.endsWith('-ui'))
  const selected = ['quickstart', 'auth', ...selectedIds, 'messaging', 'api-reference'].map(id => findGuide(id)!)
  return {
    platform, includeUi, ...snapshotInfo,
    steps: [
      'Create a ConvoKit app in the dashboard and store its client ID and client secret on your backend.',
      'Authenticate the host application user on your backend and derive their app user ID from the verified session.',
      'Create or sync that app user, then issue a scoped user token. Return the token with Cache-Control: no-store.',
      'Use get_code_examples on the selected platform guide for its documented installation and connection code.',
      'Configure the client with its public client ID and token provider, then connect the authenticated user.',
      'Enforce conversation membership in your backend before showing rooms to the user.',
      ...(includeUi ? ['Install the platform UI package and connect its conversation components to the SDK.'] : []),
      'Verify messaging, realtime updates, read receipts, reconnects, and logout with two test users.',
    ],
    guides: selected.map(guide => metadata(guide)),
    backendExamples: codeExamples(findGuide('quickstart')!).slice(0, 3),
  }
}
