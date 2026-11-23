import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'
import { KEY_STORAGE } from './storage'

afterEach(() => {
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

function stubFetch() {
  const fetchMock = vi.fn().mockResolvedValue(new Response('[]', { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('API key', () => {
  it('is sent on every request once saved', async () => {
    window.localStorage.setItem(KEY_STORAGE, 'k-123')
    const fetchMock = stubFetch()
    await api.listSearches()
    const headers = fetchMock.mock.calls[0][1].headers as Headers
    expect(headers.get('X-API-Key')).toBe('k-123')
  })

  it('is omitted when none is saved', async () => {
    const fetchMock = stubFetch()
    await api.listSearches()
    expect((fetchMock.mock.calls[0][1].headers as Headers).has('X-API-Key')).toBe(false)
  })

  it('shows the server message on 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: 'invalid or missing X-API-Key' }), { status: 401 })))
    await expect(api.listSearches()).rejects.toMatchObject({ status: 401, message: 'invalid or missing X-API-Key' })
  })
})
