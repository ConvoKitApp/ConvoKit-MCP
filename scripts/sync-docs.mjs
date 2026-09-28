import { build } from 'esbuild'
import { load } from 'cheerio'
import TurndownService from 'turndown'
import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import { createRequire } from 'node:module'

const root = fileURLToPath(new URL('../', import.meta.url))
const landing = path.resolve(process.argv[2] ?? path.join(root, '../Convokit-LandingPage'))
const requireFromLanding = createRequire(path.join(landing, 'package.json'))
const components = {
  overview: 'DocsOverview', quickstart: 'DocsQuickstart', auth: 'DocsAuth',
  messaging: 'DocsMessaging', 'api-reference': 'DocsApiReference',
  'javascript-sdk': 'DocsJavascriptSdk', 'react-ui': 'DocsReactUi', 'vue-ui': 'DocsVueUi',
  'react-native-sdk': 'DocsReactNativeSdk', 'react-native-ui': 'DocsReactNativeUi',
  'flutter-sdk': 'DocsFlutterSdk', 'flutter-ui': 'DocsFlutterUi',
  'swift-sdk': 'DocsSwiftSdk', 'swift-ui': 'DocsSwiftUi',
  'android-sdk': 'DocsAndroidSdk', 'android-ui': 'DocsAndroidUi',
  sdks: 'DocsSdkRoadmap', operations: 'DocsOperations',
  mcp: 'DocsMcp',
}
const platforms = {
  'javascript-sdk': ['javascript', 'react', 'vue'], 'react-ui': ['react'], 'vue-ui': ['vue'],
  'react-native-sdk': ['react-native'], 'react-native-ui': ['react-native'],
  'flutter-sdk': ['flutter'], 'flutter-ui': ['flutter'],
  'swift-sdk': ['swift'], 'swift-ui': ['swift'],
  'android-sdk': ['android'], 'android-ui': ['android'],
}

const imports = Object.entries(components).map(([id, component]) =>
  `import { ${component} } from ${JSON.stringify(path.join(landing, 'src/pages/docs', `${component}.tsx`))};`
).join('\n')
const entry = `
  import React from 'react';
  import { renderToStaticMarkup } from 'react-dom/server';
  import { MemoryRouter } from 'react-router-dom';
  import { docsRoutes } from ${JSON.stringify(path.join(landing, 'src/content/docsSections.ts'))};
  ${imports}
  const components = {${Object.entries(components).map(([id, component]) => `${JSON.stringify(id)}: ${component}`).join(',')}};
  export const pages = docsRoutes.map(route => ({ ...route, html: renderToStaticMarkup(React.createElement(MemoryRouter, { initialEntries: [route.path] }, React.createElement(components[route.id]))) }));
`
// Render the same React source as the public documentation. This preserves real
// snippets, tables, and prose rather than guessing at code by stripping JSX.
const bundlePath = path.join(root, `.docs-render.${process.pid}.cjs`)
try {
  await build({
    stdin: { contents: entry, loader: 'tsx', resolveDir: landing },
    outfile: bundlePath, bundle: true, platform: 'node', format: 'cjs',
    jsx: 'automatic', packages: 'external',
    plugins: [{
      name: 'landing-runtime',
      setup(builder) {
        // Render the original snippet prop directly, avoiding Prism's line
        // wrappers and decorative copy controls in the Markdown export.
        builder.onLoad({ filter: /components\/ui\/code-block\.tsx$/ }, () => ({
          contents: `import { createElement } from 'react'; export function CodeBlock({ code, language = 'bash' }) { return createElement('pre', { 'data-language': language }, code); }`,
          loader: 'tsx',
        }))
        builder.onResolve({ filter: /^[^./]|^@/ }, args => ({
          path: requireFromLanding.resolve(args.path), external: true,
        }))
      },
    }],
  })
  const { pages } = (await import(pathToFileURL(bundlePath).href)).default
  const markdown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' })
  markdown.addRule('code-block', {
    filter: node => node.nodeName === 'PRE',
    replacement: (_content, node) => {
      const language = node.getAttribute('data-language') || ''
      const code = node.textContent.replace(/\n$/, '')
      const longestFence = Math.max(2, ...[...code.matchAll(/`+/g)].map(match => match[0].length))
      const fence = '`'.repeat(longestFence + 1)
      return `\n\n${fence}${language}\n${code}\n${fence}\n\n`
    },
  })
  markdown.addRule('table', {
    filter: 'table',
    replacement: (_content, node) => {
      const rows = Array.from(node.getElementsByTagName('tr')).map(row => Array.from(row.children)
        .map(cell => markdown.turndown(cell.innerHTML).replace(/\n/g, ' ').replace(/\|/g, '\\|')))
      if (!rows.length) return ''
      const width = Math.max(...rows.map(row => row.length))
      const row = cells => `| ${Array.from({ length: width }, (_, i) => cells[i] ?? '').join(' | ')} |`
      return `\n\n${row(rows[0])}\n${row(Array(width).fill('---'))}\n${rows.slice(1).map(row).join('\n')}\n\n`
    },
  })
  const guides = []
  for (const page of pages) {
    const $ = load(page.html)
    $('svg, button, [aria-hidden="true"]').remove()
    $('.code-block-shell').each((_i, element) => {
      const shell = $(element)
      const language = shell.find('.code-block-toolbar > span').text()
      const pre = shell.find('pre').first()
      pre.attr('data-language', language)
      // Prism renders lines in divs without newline separators.
      const lines = pre.children('div').map((_index, line) => $(line).text()).get()
      if (lines.length) pre.text(lines.join('\n'))
      shell.replaceWith(pre)
    })
    $('.code-block-toolbar').remove()
    $('a[href]').each((_i, element) => {
      const anchor = $(element)
      anchor.attr('href', new URL(anchor.attr('href'), `https://convokit.app${page.path}`).href)
    })
    const text = markdown.turndown($('article').html() ?? $.html())
    if (text.length < 100) throw new Error(`Empty documentation: ${page.id}`)
    guides.push({
      id: page.id, title: page.label, description: page.description,
      url: `https://convokit.app${page.path}`, platforms: platforms[page.id] ?? [], text,
      source: `src/pages/docs/${components[page.id]}.tsx`,
    })
  }
  const sources = await Promise.all(Object.values(components).map(component => readFile(path.join(landing, 'src/pages/docs', `${component}.tsx`))))
  const sourceHash = createHash('sha256').update(JSON.stringify(guides)).digest('hex')
  await mkdir(path.join(root, 'src/content'), { recursive: true })
  await writeFile(path.join(root, 'src/content/guides.json'), JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), sourceHash, guides }, null, 2) + '\n')
  process.stderr.write(`Synced ${guides.length} public guides (${sources.reduce((sum, source) => sum + source.length, 0)} source bytes).\n`)
} finally {
  await rm(bundlePath, { force: true })
}
