// « Publier »: one standalone HTML file of the review page, readable on claude.ai without the local server, and what the Artifact tool answered.
import { texts } from '../i18n'
import type { PageAnswer, PageData, PageReview } from '../model'

/** The page's own modules, imported by app.js under these names. */
type Modules = Record<string, string>

const EXPORTED = /^export (?:async function|function|const|let) (\w+)/gm
const IMPORTED = /^import \{([^}]*)\} from '(\.\/[\w-]+\.js)'[ \t]*$/gm
/** Same check as the page's artifactHref: a claude.ai page over https, never a link elsewhere. */
export const isArtifactUrl = (url: unknown): url is string => typeof url === 'string' && /^https:\/\/claude\.ai\//.test(url)

/** Why a publish did not go through: the tool refused it, the person or a hook said no, or something else went wrong. */
export type PublishFailure = 'refused' | 'denied' | 'failed'

/** `</script` or `<!--` inside an inline script would end it or bend how the browser reads it; `\x3C` means `<` in strings and regexes, and is harmless in comments. */
const scriptSafe = (code: string) => code.replace(/<(?=\/script|!--)/gi, '\\x3C')
/** In JSON every `<` becomes its `\u` escape: no tag can end the data block. */
const jsonSafe = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c')
const styleSafe = (css: string) => css.replace(/<\/(?=style)/gi, '<\\/')
const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }
const htmlEscape = (text: string) => text.replace(/[&<>"]/g, c => ENTITIES[c]!)

/** The page modules in an order where each comes after the ones it imports; modules importing each other cannot be joined. */
function byDependencies(modules: Modules): string[] {
  const order: string[] = []
  const visit = (name: string, path: readonly string[]) => {
    if (order.includes(name)) return
    if (path.includes(name)) throw new Error('standalone page: page modules import each other')
    for (const [, , from] of modules[name]!.matchAll(IMPORTED)) if (Object.hasOwn(modules, from!)) visit(from!, [...path, name])
    order.push(name)
  }
  for (const name of Object.keys(modules)) visit(name, [])
  return order
}

/** One module out of app.js and the modules it imports: each page module runs in its own function scope (its names stay its own) and hands back its exports. */
function bundle(app: string, modules: Modules): string {
  const names = Object.keys(modules)
  const id = (name: string) => `__module${names.indexOf(name)}`
  // An import of a page module takes the exports of its scope, which comes before.
  const link = (code: string) => code.replace(IMPORTED, (line, imported: string, from: string) => (Object.hasOwn(modules, from) ? `const {${imported}} = ${id(from)}` : line))
  const scopes = byDependencies(modules).map(name => {
    const code = modules[name]!
    const exported = [...code.matchAll(EXPORTED)].map(match => match[1])
    return `const ${id(name)} = (() => {\n${link(code).replace(EXPORTED, match => match.slice('export '.length))}\nreturn { ${exported.join(', ')} }\n})()`
  })
  const code = [...scopes, link(app)].join('\n')
  // A module shape this join does not know would leave a blank page: better no publish at all.
  if (/^\s*(import|export)\b/m.test(code)) throw new Error('standalone page: a module statement was left')
  return code
}

/** The publish file's name part: the folder and the branch, nothing a path or a shell would read otherwise. */
export const publishName = (name: string, branch: string): string => `${name}-${branch}`.replace(/[^\w.-]+/g, '-')

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** A macOS home folder, `/Users/<name>`, its name ending where a path or a sentence goes on. */
const USERS_HOME = /\/Users\/[\w-]+(?:\.[\w-]+)*/g

/**
 * A text of the copy without this Mac's folders: the review folder's paths read relative to it, and the home folder (this
 * session's, or any `/Users/<name>`) reads `~`, so a sibling folder reads `~/…`.
 */
function scrub(text: string, root: string, name: string, home: string): string {
  const relative = text.split(`${root.replace(/\/+$/, '')}/`).join('').split(root).join(name)
  const own = home.replace(/\/+$/, '')
  const homeless = own === '' ? relative : relative.replace(new RegExp(`${escapeRegExp(own)}(?![\\w-]|\\.[\\w-])`, 'g'), '~')
  return homeless.replace(USERS_HOME, '~')
}

/** A review's answers and explanations, scrubbed. */
function scrubbed(review: PageReview, home: string): Pick<PageReview, 'answers' | 'files'> {
  const clean = (text: string) => scrub(text, review.root, review.name, home)
  const answer = (a: PageAnswer): PageAnswer => ({ ...a, question: clean(a.question), answer: clean(a.answer) })
  return {
    answers: review.answers.filter(a => a.status === 'done').map(answer),
    files: review.files.map(file => ({
      ...file, hunks: file.hunks.map(hunk => ({ ...hunk, notes: hunk.notes.map(note => ({ ...note, explanation: clean(note.explanation) })) })),
    })),
  }
}

/**
 * The page as one file: style, code and data inline, one review (`root`), read only (no question field, no button that
 * writes: app.js reads `readonly`), nothing to fetch. The data shows no publish button, no artifact link and no Sources column (a PR's header stays), the
 * review is known by its name, never by its absolute path on this Mac, and reads « à jour »: no passing status is frozen.
 * Only the finished answers stay; they and the explanations name no folder of this Mac (`home`: the session's home folder).
 * `modules` are the page's own modules, by the name the page imports them under.
 */
export function standaloneHtml(indexHtml: string, css: string, js: string, modules: Modules, data: PageData, root: string, home: string): string {
  const reviews = data.reviews.filter(r => r.root === root).map(r => ({ ...r, ...scrubbed(r, home), root: r.name, status: 'idle' as const, error: null }))
  const own: PageData = { ...data, reviews, publish: false, published: {}, publishFailed: {}, sources: [], readonly: true }
  const title = `${texts(data.lang).paneTitle} ${reviews[0]?.name ?? ''}`.trim()
  const inline = `<style>${styleSafe(css)}</style>\n`
    + `<script type="application/json" id="intent-data">${jsonSafe(own)}</script>\n`
    + `<script type="module">${scriptSafe(bundle(js, modules))}</script>`
  // Replaced by functions: the code holds `$&` and its kin, which a replacement string would expand.
  return indexHtml
    .replace(/<title>[\s\S]*?<\/title>/, () => `<title>${htmlEscape(title)}</title>`)
    .replace(/<script>[\s\S]*?<\/script>/, () => inline) // the bootstrap that loads each file from the server with its token
    .replace(/<form[\s\S]*?<\/form>\s*/, () => '')
}

/** The first claude.ai address in a text, without the punctuation that closes its sentence. */
const ARTIFACT_IN_TEXT = /https:\/\/claude\.ai\/[^\s"'<>()[\]]*[^\s"'<>()[\].,;:!?]/

/**
 * What a call to the Artifact tool came to: the address it published at, a refusal by the tool itself (another try may do),
 * a no, or a failure. The address is `result.url`; without one, the first claude.ai address of a string result or of the text.
 */
export function artifactOutcome(answer: unknown): { url: string } | PublishFailure {
  if (!isRecord(answer)) return 'failed'
  if (typeof answer.deny === 'string') return 'denied'
  if (answer.isError === true) return 'refused'
  const url = isRecord(answer.result) && 'url' in answer.result
    ? answer.result.url
    : [answer.result, answer.text].map(text => (typeof text === 'string' ? ARTIFACT_IN_TEXT.exec(text)?.[0] : undefined)).find(Boolean)
  return isArtifactUrl(url) ? { url } : 'failed'
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
