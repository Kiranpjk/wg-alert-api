import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ListingIn, SearchIn } from '../types'
import { backfillWindow, createDemoApi, demoListings, demoSeed, matches } from './demoApi'

const search: SearchIn = { label: 'Campus', city: 'Jena', max_rent: 400, districts: [] }
const listing: ListingIn = {
  source: 'test-feed', external_id: '1', url: 'https://example.org/1', title: 'Campus room',
  city: 'Jena', district: 'Zentrum', rent: 400, size_m2: 14, available_from: '2026-12-15',
}

describe('demo matching rules', () => {
  it.each([
    ['city whitespace and case', { city: ' JENA ' }, { city: ' jena ' }, true],
    ['Unicode full case folding', { city: 'STRASSE' }, { city: 'Straße' }, true],
    ['wrong city', {}, { city: 'Berlin' }, false],
    ['rent at ceiling', {}, { rent: 400 }, true],
    ['rent above ceiling', {}, { rent: 400.01 }, false],
    ['size at minimum', { min_size_m2: 14 }, {}, true],
    ['size below minimum', { min_size_m2: 15 }, {}, false],
    ['missing size', { min_size_m2: 15 }, { size_m2: undefined }, true],
    ['null size', { min_size_m2: 15 }, { size_m2: null }, true],
    ['normalized district in list', { districts: ['Lobeda', ' ZENTRUM '] }, {}, true],
    ['wrong district', { districts: ['Lobeda'] }, {}, false],
    ['missing district when restricted', { districts: ['Zentrum'] }, { district: null }, false],
    ['missing district when unrestricted', {}, { district: null }, true],
    ['move-in on deadline', { available_by: '2026-12-15' }, {}, true],
    ['move-in after deadline', { available_by: '2026-12-14' }, {}, false],
    ['move-in missing', { available_by: '2026-12-14' }, { available_from: null }, true],
    ['move-in when deadline unset', {}, { available_from: '2027-01-01' }, true],
  ] satisfies [string, Partial<SearchIn>, Partial<ListingIn>, boolean][])(
    '%s', (_label, criteria, room, expected) => {
      expect(matches({ ...search, ...criteria }, { ...listing, ...room })).toBe(expected)
    },
  )
})

describe('demo data', () => {
  beforeEach(() => window.localStorage.clear())

  it('seeds a subset of the feed so ingestion can deliver new rooms', async () => {
    const api = createDemoApi()
    const jena = await api.createSearch(search)
    expect(await api.listMatches(jena.id)).toHaveLength(1)
    expect(await api.ingest(demoListings)).toMatchObject({ created: 11, duplicates: demoSeed.length })
    expect((await api.listMatches(jena.id)).length).toBeGreaterThan(1)
  })

  it('dedupes within and across batches with a source/external ID pair', async () => {
    const api = createDemoApi({ seed: [] })
    const saved = await api.createSearch(search)
    expect(await api.ingest([listing, listing, { ...listing, source: 'another' }]))
      .toEqual({ created: 2, duplicates: 1, matches: 2 })
    expect(await api.ingest([listing])).toEqual({ created: 0, duplicates: 1, matches: 0 })
    expect(await api.listMatches(saved.id)).toHaveLength(2)
  })

  it('backfills inclusively at seven days and excludes older rooms', async () => {
    let now = Date.UTC(2026, 10, 23)
    const api = createDemoApi({ now: () => now, seed: [] })
    await api.ingest([listing])
    now++
    await api.ingest([{ ...listing, external_id: '2' }])
    now += backfillWindow
    const saved = await api.createSearch(search)
    expect((await api.listMatches(saved.id)).map((match) => match.listing.external_id)).toEqual(['2'])
  })

  it('returns newest IDs first when timestamps tie', async () => {
    const api = createDemoApi({ seed: [], now: () => 0 })
    const saved = await api.createSearch(search)
    await api.ingest([listing, { ...listing, external_id: '2' }])
    expect((await api.listMatches(saved.id)).map((item) => item.listing.external_id)).toEqual(['2', '1'])
  })

  it('marks only that search’s matches and keeps future arrivals unseen', async () => {
    const api = createDemoApi({ seed: [listing] })
    const a = await api.createSearch(search)
    const b = await api.createSearch(search)
    expect(await api.markSeen(a.id)).toEqual({ marked_seen: 1 })
    expect(await api.markSeen(a.id)).toEqual({ marked_seen: 0 })
    expect(await api.listMatches(a.id, true)).toHaveLength(0)
    expect((await api.listMatches(a.id))[0].seen).toBe(true)
    expect(await api.listMatches(b.id, true)).toHaveLength(1)
    await api.ingest([{ ...listing, external_id: '2' }])
    expect(await api.listMatches(a.id, true)).toHaveLength(1)
  })

  it('cascades deletion and retains listings for other searches', async () => {
    const api = createDemoApi({ seed: [listing], storageKey: 'cascade' })
    const saved = await api.createSearch(search)
    await api.deleteSearch(saved.id)
    expect(await api.listSearches()).toEqual([])
    await expect(api.getSearch(saved.id)).rejects.toThrow('Search not found')
    await expect(api.listMatches(saved.id)).rejects.toThrow('Search not found')
    expect(JSON.parse(window.localStorage.getItem('cascade') ?? '{}').matches).toEqual([])
    expect(await api.listMatches((await api.createSearch(search)).id)).toHaveLength(1)
  })

  it('restores searches and seen status from browser storage', async () => {
    const api = createDemoApi({ seed: [listing] })
    const saved = await api.createSearch(search)
    await api.markSeen(saved.id)
    const restored = createDemoApi({ seed: [] })
    expect(await restored.getSearch(saved.id)).toEqual(saved)
    expect((await restored.listMatches(saved.id))[0].seen).toBe(true)
  })

  it('keeps the demo usable when storage throws', async () => {
    vi.spyOn(window.Storage.prototype, 'getItem').mockImplementation(() => { throw new Error() })
    vi.spyOn(window.Storage.prototype, 'setItem').mockImplementation(() => { throw new Error() })
    try {
      const api = createDemoApi({ seed: [listing] })
      expect(await api.listMatches((await api.createSearch(search)).id)).toHaveLength(1)
    } finally {
      vi.restoreAllMocks()
    }
  })
})
