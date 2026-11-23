import type { Match } from './types'

export type Sort = 'newest' | 'rent' | 'value'

export function visibleMatches(matches: Match[], unseenOnly: boolean, sort: Sort) {
  const costPerMetre = ({ listing }: Match) => listing.size_m2 ? listing.rent / listing.size_m2 : Infinity
  const newest = (a: Match, b: Match) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id
  return matches.filter((match) => !unseenOnly || !match.seen).sort((a, b) => {
    if (sort === 'rent') return a.listing.rent - b.listing.rent || newest(a, b)
    if (sort === 'value') return costPerMetre(a) - costPerMetre(b) || newest(a, b)
    return newest(a, b)
  })
}
