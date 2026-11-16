// The review pane, on the side: the review page's compact remote while the page runs (status and open on top, summary,
// intentions, file count, questions under way and the last answer);
// else one line on why the page cannot run (with « Ouvrir la revue » to start it again when it stopped), then the detailed view (folded code per change).
// While the shown folder's review updates, only a loading block, in both. Questions are asked on the page only.
import type { Elements } from 'claude-code'
import type { Texts } from '../i18n'
import { isArtifactUrl } from '../export/publish'
import type { KnownPr, Review, Slot } from '../model'
import { prId, targetOf } from '../prs/known'
import { isDormant, isFolder } from '../review/slots'
import type { Page } from '../server/link'
import { answerCount, circled, fileTag, folderLabel, headerText, intentionLabel, lastAnswer, pageNotice, prGroups, prLine, shortSummary, statusLine } from './lines'

/** What a press or a pick does; wired in register.ts, where `$` lives. */
export type PaneButtons = {
  toggle(key: string): void
  retry(root: string): void
  select(root: string): void
  /** Opens the review page in the default browser. */
  open(): void
  /** Opens a folder's artifact on claude.ai. */
  openArtifact(url: string): void
  /** Opens the review page on a folder or a PR (its root), and starts its review when it has none or is behind. */
  openSource(target: string): void
}

/** The review page as the pane sees it: its address or why it cannot run, whether a press waits for it to open, the artifact of each published folder, each folder's branch, the conversation's PRs. */
export type PaneLinks = {
  page: Page; opening: boolean; published: Readonly<Record<string, string>>; branches: Readonly<Record<string, string>>; prs: readonly KnownPr[]
}

/** Components, read atoms and `$` stay in register.ts: Claude Code refuses `$` crossing an import. The mobile table has no `Input` or `Select`: register.ts never passes it. */
export function drawPane(
  ui: Elements['terminal' | 'desktop' | 'vscode'],
  allSlots: readonly Slot[],
  selected: string | null,
  expanded: Readonly<Record<string, boolean>>,
  { page, opening, published, branches, prs }: PaneLinks,
  buttons: PaneButtons,
  t: Texts,
) {
  const { Box, Button, Code, Select, Text } = ui
  // A folder only read stays out of the pane and its picker; a PR is reached through the PR section only.
  const slots = allSlots.filter(s => isFolder(s) && !isDormant(s))
  const groups = prGroups(prs, allSlots)
  const group = (key: string, heading: string, entries: (typeof groups)['conversation']) =>
    entries.length > 0 && (
      <Box key={key} flexDirection="column">
        <Text bold>{heading}</Text>
        {entries.map(({ pr, reviewed }) => (
          <Box key={`line-${prId(pr.ref)}`} gap={1}>
            <Text wrap="truncate-end">{prLine(pr, reviewed, t)}</Text>
            <Button key={`open-${prId(pr.ref)}`} plain label={t.prs.open} onPress={() => buttons.openSource(targetOf(pr))} />
          </Box>
        ))}
      </Box>
    )
  // Nothing at all when the session knows no PR.
  const prSection = prs.length > 0 && (
    <Box key="prs" flexDirection="column" gap={1}>
      {group('prs-conversation', t.prs.heading, groups.conversation)}
      {group('prs-viewed', t.prs.viewedHeading, groups.viewed)}
    </Box>
  )
  if (slots.length === 0) {
    return prSection ? <Box flexDirection="column" gap={1}><Text dimColor>{t.noReview}</Text>{prSection}</Box> : <Text dimColor>{t.noReview}</Text>
  }
  const slot = slots.find(s => s.root === selected) ?? slots[0]!
  // While the review updates, nothing to read or press: it comes back once done.
  if (slot.status === 'running') {
    return (
      <Box flexDirection="column">
        <Text bold color="claude">{t.updating.title}</Text>
        <Text dimColor>{t.updating.hint}</Text>
      </Box>
    )
  }

  const folderPicker = slots.length > 1 && (
    <Select
      key="folder"
      value={slot.root}
      options={slots.map(s => ({ value: s.root, label: folderLabel(s.name, branches[s.root]) }))}
      onSelect={root => buttons.select(root)}
    />
  )

  const status = statusLine(t, slot)
  const header = (
    <Box key="header" gap={1}>
      <Text bold>{headerText(t, slot)}</Text>
      <Text color={status.color} wrap="truncate-end">{status.text}</Text>
      {(slot.status === 'failed' || slot.status === 'stale') && (
        <Button key={`retry-${slot.root}`} label={slot.status === 'failed' ? t.button.retry : t.button.refresh} onPress={() => buttons.retry(slot.root)} />
      )}
    </Box>
  )

  const skippedLine = (paths: readonly string[]) => {
    const key = `${slot.root}|skipped`
    const open = expanded[key] ?? false
    return (
      <Box key="skipped" flexDirection="column">
        <Button key={`skipped-${slot.root}`} plain dimColor label={`${open ? '▾' : '▸'} ${t.skipped(paths.length)}`} onPress={() => buttons.toggle(key)} />
        {open && paths.map((p, i) => <Text key={`skipped-${i}`} dimColor wrap="truncate-middle">{`  ${p}`}</Text>)}
      </Box>
    )
  }

  const overview = (review: Review) => [
    <Box key="summary" flexDirection="column" borderStyle="round" paddingX={1}>
      <Text bold>{t.summaryLabel}</Text>
      <Text>{review.summary}</Text>
    </Box>,
    <Box key="intentions" flexDirection="column">
      <Text dimColor>{t.intentionsLabel}</Text>
      <Box columnGap={2} flexWrap="wrap">
        {review.intentions.map((i, index) => (
          <Text key={`intention-${index}`} color={i.origin === 'inferred' ? undefined : 'claude'} dimColor={i.origin === 'inferred'}>
            {intentionLabel(t, i)}
          </Text>
        ))}
      </Box>
    </Box>,
  ]

  // The page runs: the code and the questions live there; here a count of the files and of the questions, and the last answer.
  const remote = (review: Review) => {
    const count = answerCount(t, slot.answers)
    const last = lastAnswer(slot.answers)
    return (
      <Box flexDirection="column" gap={1}>
        <Box key="summary" flexDirection="column" borderStyle="round" paddingX={1}>
          <Text bold>{t.summaryLabel}</Text>
          <Text>{shortSummary(review.summary)}</Text>
        </Box>
        <Box key="intentions" flexDirection="column">
          <Text dimColor>{t.intentionsLabel}</Text>
          {review.intentions.map((i, index) => (
            <Text key={`intention-${index}`} wrap="truncate-end" color={i.origin === 'inferred' ? undefined : 'claude'} dimColor={i.origin === 'inferred'}>
              {intentionLabel(t, i)}
            </Text>
          ))}
        </Box>
        <Text key="files" dimColor>{t.filesInPage(review.files.length)}</Text>
        {(count !== null || last !== null) && (
          <Box key="answers" flexDirection="column">
            {count !== null && <Text color="claude">{count}</Text>}
            {last !== null && <Text wrap="truncate-end">{last}</Text>}
          </Box>
        )}
      </Box>
    )
  }

  const body = (review: Review) => (
    <Box flexDirection="column" gap={1}>
      {overview(review)}
      {review.files.map((file, fi) => {
        const tag = fileTag(t, file)
        return (
          <Box key={`file-${fi}`} flexDirection="column">
            <Box gap={1}>
              <Text bold wrap="truncate-middle">{file.path}</Text>
              {tag && <Text color={tag.color}>{tag.text}</Text>}
            </Box>
            <Text dimColor>{file.role}</Text>
            {file.changes.map((change, ci) => {
              const key = `${slot.root}|${file.path}|${change.hunk}`
              const open = expanded[key] ?? false
              return (
                <Box key={`change-${fi}-${ci}`} flexDirection="column" paddingLeft={2} marginTop={1}>
                  <Box gap={1}>
                    {change.intention !== null && <Text color="claude">{circled(change.intention)}</Text>}
                    <Text>{change.explanation}</Text>
                  </Box>
                  <Box gap={1} flexWrap="wrap">
                    {/* No code until a resumed review gets it back from the diff. */}
                    {change.text !== '' && (
                      <Button key={`code-${fi}-${ci}`} plain label={open ? t.button.hideCode : t.button.showCode} onPress={() => buttons.toggle(key)} />
                    )}
                  </Box>
                  {open && change.text !== '' && <Code key={`diff-${fi}-${ci}`} source={change.text} format="diff" path={file.path} />}
                </Box>
              )
            })}
          </Box>
        )
      })}
      {review.skipped.length > 0 && skippedLine(review.skipped)}
    </Box>
  )

  const running = page !== null && 'url' in page
  const notice = pageNotice(t, page)
  // A page whose server stopped or did not start can start again from here; without python it cannot.
  const restartable = page !== null && 'error' in page && page.error !== 'python'
  // While a press waits for the server, nothing to press again.
  const openReview = opening
    ? <Text key="opening" color="claude">{t.opening}</Text>
    : <Button key="open-review" label={t.button.openReview} onPress={() => buttons.open()} />
  const artifact = published[slot.root]
  const artifactButton = isArtifactUrl(artifact) && (
    <Button key="open-artifact" plain label={t.button.openArtifact} onPress={() => buttons.openArtifact(artifact)} />
  )
  if (running) {
    return (
      <Box flexDirection="column" gap={1}>
        {folderPicker}
        {prSection}
        <Box key="top" gap={2} flexWrap="wrap">
          <Text color={status.color} wrap="truncate-end">{status.text}</Text>
          {(slot.status === 'failed' || slot.status === 'stale') && (
            <Button key={`retry-${slot.root}`} label={slot.status === 'failed' ? t.button.retry : t.button.refresh} onPress={() => buttons.retry(slot.root)} />
          )}
          {openReview}
          {artifactButton}
        </Box>
        {slot.gone && <Text color="warning">{t.gone}</Text>}
        {slot.empty ? <Text dimColor>{t.noChange}</Text> : slot.review && remote(slot.review)}
      </Box>
    )
  }
  return (
    <Box flexDirection="column" gap={1}>
      {notice !== null && <Text key="page-notice" color="warning">{notice}</Text>}
      {restartable && <Box key="reopen">{openReview}</Box>}
      {folderPicker}
      {prSection}
      {header}
      {slot.gone && <Text color="warning">{t.gone}</Text>}
      {slot.empty ? <Text dimColor>{t.noChange}</Text> : slot.review && body(slot.review)}
      {artifactButton && <Box key="links" gap={2}>{artifactButton}</Box>}
    </Box>
  )
}
