import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api'
import { visibleMatches } from '../matchView'
import { useTheme } from '../theme'
import type { Match } from '../types'
import { MatchCard } from './MatchCard'
import { SearchForm } from './SearchForm'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.localStorage.clear()
})

function fillForm() {
  fireEvent.change(screen.getByLabelText('Search name'), { target: { value: ' Campus ' } })
  fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Jena' } })
  fireEvent.change(screen.getByLabelText('Max. warm rent (€)'), { target: { value: '450' } })
}

describe('SearchForm', () => {
  it('reports required fields and focuses the first error', () => {
    const onSave = vi.fn()
    render(<SearchForm onSave={onSave} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save search' }))
    expect(screen.getByText('Enter a name between 1 and 100 characters.')).toBeTruthy()
    expect(screen.getByText('Enter a city between 2 and 80 characters.')).toBeTruthy()
    expect(screen.getByText('Enter a rent above €0 and up to €5,000.')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByLabelText('Search name'))
    expect(onSave).not.toHaveBeenCalled()
  })

  it('enforces server upper bounds for name, city, rent and size', () => {
    render(<SearchForm onSave={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Search name'), { target: { value: 'x'.repeat(101) } })
    fireEvent.change(screen.getByLabelText('City'), { target: { value: 'x'.repeat(81) } })
    fireEvent.change(screen.getByLabelText('Max. warm rent (€)'), { target: { value: '5001' } })
    fireEvent.change(screen.getByLabelText('Min. size (m², optional)'), { target: { value: '501' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save search' }))
    expect(document.querySelectorAll('[aria-invalid=true]')).toHaveLength(4)
  })

  it('adds with Enter and comma, removes with Backspace, and includes the final draft', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<SearchForm onSave={onSave} />)
    fillForm()
    const input = screen.getByLabelText('Districts (optional)')
    fireEvent.change(input, { target: { value: ' Zentrum ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.change(input, { target: { value: 'Lobeda,' } })
    expect(screen.getByRole('button', { name: 'Remove Lobeda' })).toBeTruthy()
    fireEvent.keyDown(input, { key: 'Backspace' })
    expect(screen.queryByRole('button', { name: 'Remove Lobeda' })).toBeNull()
    fireEvent.change(input, { target: { value: 'Jena-West' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save search' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({
      label: 'Campus', city: 'Jena', max_rent: 450, min_size_m2: null,
      districts: ['Zentrum', 'Jena-West'], available_by: null,
    }))
  })

  it('keeps the submitted values and shows server 422 details', async () => {
    const onSave = vi.fn().mockRejectedValue(new ApiError(422, { city: 'City rejected' }, 'Validation failed'))
    render(<SearchForm onSave={onSave} />)
    fillForm()
    fireEvent.click(screen.getByRole('button', { name: 'Save search' }))
    expect(await screen.findByText('City rejected')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toBe('Validation failed')
    expect((screen.getByLabelText('City') as HTMLInputElement).value).toBe('Jena')
  })
})

const template: Match = {
  id: 1, seen: false, created_at: '2026-11-23T10:00:00Z',
  listing: {
    id: 1, source: 'demo-feed', external_id: '1', url: 'https://example.org/room',
    title: 'Near the library', city: 'Jena', rent: 420, size_m2: 15, district: 'Zentrum',
    available_from: '2026-12-01', received_at: '2026-11-23T08:00:00Z',
  },
}

describe('MatchCard', () => {
  it('shows rent, value, availability, relative time, and the New badge', () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse(template.created_at))
    render(<MatchCard match={template} />)
    for (const label of ['€420', '€28.00', '15 m²', 'New', '1 Dec 2026', '2 h ago', 'Zentrum, Jena']) {
      expect(screen.getByText(label)).toBeTruthy()
    }
  })

  it('uses safe external-link attributes', () => {
    render(<MatchCard match={template} />)
    const link = screen.getByRole('link', { name: /view listing/i })
    expect(link.getAttribute('href')).toBe('https://example.org/room')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('omits the badge for seen cards and rejects an unsafe URL', () => {
    render(<MatchCard match={{ ...template, seen: true, listing: { ...template.listing, url: 'javascript:alert(1)', size_m2: null } }} />)
    expect(screen.queryByText('New')).toBeNull()
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('Unlisted')).toBeTruthy()
  })
})

const older: Match = { ...template, id: 2, seen: true, created_at: '2026-11-23T09:00:00Z', listing: { ...template.listing, rent: 480, size_m2: 24 } }
const missing: Match = { ...template, id: 3, listing: { ...template.listing, rent: 330, size_m2: undefined } }

it.each([
  [false, 'newest', [3, 1, 2]],
  [false, 'rent', [3, 1, 2]],
  [false, 'value', [2, 1, 3]],
  [true, 'value', [1, 3]],
] as const)('filters unseen=%s and sorts by %s', (unseen, sort, expected) => {
  const input = [template, older, missing]
  expect(visibleMatches(input, unseen, sort).map(({ id }) => id)).toEqual(expected)
  expect(input.map(({ id }) => id)).toEqual([1, 2, 3])
})

function ThemeControl() {
  const { theme, toggle } = useTheme()
  return <button onClick={toggle}>{theme}</button>
}

it('persists theme across remounts', () => {
  const { unmount } = render(<ThemeControl />)
  fireEvent.click(screen.getByRole('button', { name: 'light' }))
  expect(document.documentElement.dataset.theme).toBe('dark')
  unmount()
  render(<ThemeControl />)
  expect(screen.getByRole('button', { name: 'dark' })).toBeTruthy()
})

it('toggles theme when localStorage reads and writes throw', () => {
  vi.spyOn(window.Storage.prototype, 'getItem').mockImplementation(() => { throw new Error() })
  vi.spyOn(window.Storage.prototype, 'setItem').mockImplementation(() => { throw new Error() })
  render(<ThemeControl />)
  fireEvent.click(screen.getByRole('button', { name: 'light' }))
  expect(document.documentElement.dataset.theme).toBe('dark')
})
