import type { Api, Listing, ListingIn, Match, Search, SearchIn } from '../types'
import { readStored, writeStored } from '../storage'
import casefold from './casefold.json'
import listings from './listings.json'

export const demoListings: ListingIn[] = listings
export const demoSeed = [listings[0], listings[7], listings[10], listings[12]]
export const backfillWindow = 7 * 24 * 60 * 60 * 1000

const folds: Record<string, string> = casefold
function normalize(value?: string | null) {
  // Use Python's whitespace set and full case-fold expansions.
  // eslint-disable-next-line no-control-regex -- Python strips these control characters.
  const trimmed = (value ?? '').replace(/^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/gu, '')
  return Array.from(trimmed, (character) => folds[character] ?? character.toLowerCase()).join('')
}

export function matches(search: SearchIn, listing: ListingIn): boolean {
  if (normalize(search.city) !== normalize(listing.city)) return false
  if (listing.rent > search.max_rent) return false
  if (search.min_size_m2 && listing.size_m2 && listing.size_m2 < search.min_size_m2) return false
  if (search.districts.length && !search.districts.some((district) => normalize(district) === normalize(listing.district))) return false
  if (search.available_by && listing.available_from && listing.available_from > search.available_by) return false
  return true
}

interface State {
  nextId: number
  searches: Search[]
  listings: Listing[]
  matches: (Match & { searchId: number })[]
}

export function createDemoApi({ now = Date.now, storageKey = 'wg-alert:demo:v1', seed = demoSeed }: {
  now?: () => number
  storageKey?: string
  seed?: ListingIn[]
} = {}): Api {
  function timestamp() { return new Date(now()).toISOString() }

  function load(): State {
    try {
      const saved = JSON.parse(readStored(storageKey) ?? 'null')
      if (saved && Number.isInteger(saved.nextId) && Array.isArray(saved.searches)
        && Array.isArray(saved.listings) && Array.isArray(saved.matches)) return saved
    } catch {
      // Invalid stored data starts a fresh demo.
    }
    return {
      nextId: seed.length + 1, searches: [], matches: [],
      listings: seed.map((listing, index) => ({ ...listing, id: index + 1, received_at: timestamp() })),
    }
  }

  const state = load()
  function persist() { writeStored(storageKey, JSON.stringify(state)) }
  persist()

  function find(id: number) {
    const search = state.searches.find((item) => item.id === id)
    if (!search) throw new Error('Search not found.')
    return search
  }

  function addMatch(searchId: number, listing: Listing) {
    state.matches.push({ id: state.nextId++, searchId, seen: false, created_at: timestamp(), listing })
  }

  return {
    async health() { return { status: 'ok' } },
    async listSearches() { return structuredClone(state.searches) },
    async getSearch(id) { return structuredClone(find(id)) },
    async createSearch(input) {
      const search = { ...structuredClone(input), id: state.nextId++, active: true, created_at: timestamp() }
      state.searches.push(search)
      const since = now() - backfillWindow
      for (const listing of state.listings) {
        if (Date.parse(listing.received_at) >= since && matches(search, listing)) addMatch(search.id, listing)
      }
      persist()
      return structuredClone(search)
    },
    async deleteSearch(id) {
      find(id)
      state.searches = state.searches.filter((search) => search.id !== id)
      state.matches = state.matches.filter((match) => match.searchId !== id)
      persist()
    },
    async ingest(listings) {
      if (listings.length > 500) throw new Error('A batch can contain up to 500 listings.')
      const result = { created: 0, duplicates: 0, matches: 0 }
      const keys = new Set(state.listings.map(({ source, external_id }) => JSON.stringify([source, external_id])))
      for (const input of listings) {
        const key = JSON.stringify([input.source, input.external_id])
        if (keys.has(key)) {
          result.duplicates++
          continue
        }
        keys.add(key)
        const listing = { ...input, id: state.nextId++, received_at: timestamp() }
        state.listings.push(listing)
        result.created++
        for (const search of state.searches) {
          if (search.active && matches(search, listing)) {
            addMatch(search.id, listing)
            result.matches++
          }
        }
      }
      persist()
      return result
    },
    async listMatches(id, unseenOnly = false) {
      find(id)
      return structuredClone(state.matches
        .filter((match) => match.searchId === id && (!unseenOnly || !match.seen))
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id)
        .map(({ id, seen, created_at, listing }) => ({ id, seen, created_at, listing })))
    },
    async markSeen(id) {
      find(id)
      let marked_seen = 0
      for (const match of state.matches) {
        if (match.searchId === id && !match.seen) {
          match.seen = true
          marked_seen++
        }
      }
      persist()
      return { marked_seen }
    },
  }
}
