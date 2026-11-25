import type { WeeklyReview } from './review.js'

export function reviewMarkdown(input: {
  email: string
  builtAt: string
  reviewId: string
  digest: WeeklyReview
}): string {
  const digest = input.digest
  const radios = (digest.newRadios ?? []).map((row) => `- ${row.label} (${row.kind}) ${row.id}`)
  const remainder = digest.newRadioRemainder ?? 0
  if (remainder > 0) radios.push(`- ${remainder} more`)
  return [
    '# Observer.to review',
    '',
    `Account: ${input.email}`,
    `Built: ${input.builtAt}`,
    `Review: ${input.reviewId}`,
    '',
    'This file is a download for the signed-in account. It is not a shared link.',
    '',
    '## New radios',
    radios.length ? radios.join('\n') : '- None',
    '',
    '## Open networks',
    lines(digest.openNetworks.map((row) => `${row.name} (${row.security})`)),
    '',
    '## High risk from public research',
    lines(digest.highRisk.map((row) => `${row.name}: ${row.reason}`)),
    '',
    '## Site findings',
    lines((digest.siteFindings ?? []).map((row) => `${row.site}: ${row.label}`)),
    '',
    '## Site events',
    lines((digest.siteEvents ?? []).map((row) => `${row.site}: ${row.label}`)),
    '',
    '## Owned-network changes',
    lines((digest.ownedChanges ?? []).map((row) => row.text)),
    '',
    '## Walks due',
    lines((digest.overdueWalks ?? []).map((row) => `${row.site} due ${row.dueAt}`)),
    '',
  ].join('\n')
}

export function reviewCsv(digest: WeeklyReview): string {
  const rows = ['kind,id,label,first_seen,lat,lon']
  for (const radio of digest.newRadios ?? []) {
    rows.push([
      radio.kind,
      radio.id,
      csv(radio.label),
      radio.firstSeen,
      radio.lat ?? '',
      radio.lon ?? '',
    ].join(','))
  }
  return `${rows.join('\n')}\n`
}

function lines(rows: string[]): string {
  return rows.length ? rows.map((row) => `- ${row}`).join('\n') : '- None'
}

function csv(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}
