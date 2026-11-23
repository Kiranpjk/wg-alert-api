import { createHash, webcrypto } from 'node:crypto'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import App from '../App'
import { createDemoApi } from '../demo/demoApi'
import type { ParseAdResult } from '../types'
import { AdImport } from './AdImport'

const ad = 'Möbliertes Zimmer in Jena, 340 Euro warm.'
const example: ParseAdResult = {
  draft: {
    title: 'Furnished room', city: 'Jena', district: 'Lobeda', rent: 340,
    rent_kind: 'warm', size_m2: 18, available_from: '2027-01-01', url: 'https://example.org/room',
  },
  removed_contact_details: 0, warnings: [],
}

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  vi.unstubAllGlobals()
})

function paste(text = ad) {
  fireEvent.change(screen.getByLabelText('Paste the ad'), { target: { value: text } })
  fireEvent.click(screen.getByRole('button', { name: 'Extract details' }))
}

function review(result = example) {
  const client = createDemoApi({ seed: [] })
  const extract = vi.spyOn(client, 'parseAd').mockResolvedValue(result)
  const ingest = vi.spyOn(client, 'ingest')
  const onClose = vi.fn()
  render(<AdImport client={client} demo={false} onClose={onClose} onSaved={vi.fn()} />)
  return { extract, ingest, onClose }
}

it('extracts the canned demo draft, saves the edited warm rent and refreshes matches', async () => {
  const client = createDemoApi({ seed: [] })
  await client.createSearch({ label: 'Rooms in Jena', city: 'Jena', max_rent: 400, districts: [] })
  const ingest = vi.spyOn(client, 'ingest')
  vi.stubGlobal('crypto', webcrypto)
  render(<App client={client} demo />)
  await screen.findByText('No matches yet')
  expect(screen.getAllByRole('button', { name: 'Add from ad' })).toHaveLength(2)
  fireEvent.click(within(screen.getByRole('button', { name: 'Settings' }).parentElement!).getByRole('button', { name: 'Add from ad' }))
  paste()
  expect(screen.getByText('Extracting details…')).toBeTruthy()
  const rent = await screen.findByLabelText('Rent (EUR warm)')
  expect(screen.getByText('Demo: this is a canned example, no AI is called.')).toBeTruthy()
  expect((rent as HTMLInputElement).value).toBe('340')
  expect(ingest).not.toHaveBeenCalled()
  fireEvent.change(rent, { target: { value: '365' } })
  fireEvent.click(screen.getByRole('button', { name: 'Add to feed' }))
  expect(await screen.findByText('1 added, 1 matches')).toBeTruthy()
  expect(await screen.findByText('Furnished room in a shared flat')).toBeTruthy()
  expect(ingest).toHaveBeenCalledWith([expect.objectContaining({
    source: 'pasted', rent: 365, external_id: createHash('sha256').update(ad).digest('hex').slice(0, 16),
  })], undefined)
})

it('announces warnings and asks the user to enter warm rent if only cold rent was found', async () => {
  review({
    draft: { ...example.draft, rent_kind: 'cold', url: null }, removed_contact_details: 2,
    warnings: ['Only cold rent (Kaltmiete) was found; the API compares warm rent.', 'No link found; add the ad link before saving.'],
  })
  paste()
  const warnings = await screen.findByRole('list')
  expect(warnings.closest('[aria-live]')?.getAttribute('aria-live')).toBe('polite')
  expect(within(warnings).getAllByRole('listitem')).toHaveLength(2)
  expect(screen.getByText('Contact details removed: 2')).toBeTruthy()
  const rent = screen.getByLabelText('Rent (EUR warm)') as HTMLInputElement
  expect(rent.value).toBe('')
  expect(rent.hasAttribute('data-empty')).toBe(true)
})

it('requires the link before saving', async () => {
  const { ingest } = review({ ...example, draft: { ...example.draft, url: null } })
  paste()
  fireEvent.click(await screen.findByRole('button', { name: 'Add to feed' }))
  expect(screen.getByText('Enter the ad link.')).toBeTruthy()
  expect(document.activeElement).toBe(screen.getByLabelText('Link'))
  expect(ingest).not.toHaveBeenCalled()
})

it('rejects links outside HTTP(S) and rents above the server limit', async () => {
  const { ingest } = review()
  paste()
  fireEvent.change(await screen.findByLabelText('Link'), { target: { value: 'ftp://example.org/ad' } })
  fireEvent.change(screen.getByLabelText('Rent (EUR warm)'), { target: { value: '10001' } })
  fireEvent.click(screen.getByRole('button', { name: 'Add to feed' }))
  expect(screen.getByText('Enter an HTTP or HTTPS link of up to 500 characters.')).toBeTruthy()
  expect(screen.getByText('Enter a warm rent above €0 and up to €10,000.')).toBeTruthy()
  expect(ingest).not.toHaveBeenCalled()
})

it('shows a parse error and keeps the pasted text available for retry', async () => {
  const { extract } = review()
  extract.mockRejectedValueOnce(new Error('Daily AI parsing limit reached.'))
  paste()
  expect((await screen.findByRole('alert')).textContent).toBe('Daily AI parsing limit reached.')
  expect((screen.getByLabelText('Paste the ad') as HTMLTextAreaElement).value).toBe(ad)
  expect(screen.queryByRole('button', { name: 'Add to feed' })).toBeNull()
})

it('preserves the pasted text on Back and permits a new extraction', async () => {
  const { extract } = review()
  paste()
  fireEvent.click(await screen.findByRole('button', { name: 'Back' }))
  expect((screen.getByLabelText('Paste the ad') as HTMLTextAreaElement).value).toBe(ad)
  paste(ad + ' Ab Januar.')
  expect(extract).toHaveBeenLastCalledWith(ad + ' Ab Januar.')
  await screen.findByRole('button', { name: 'Add to feed' })
})

it('limits pasted text to 6000 characters and disables extraction below 20', () => {
  review()
  const textarea = screen.getByLabelText('Paste the ad') as HTMLTextAreaElement
  const button = screen.getByRole('button', { name: 'Extract details' }) as HTMLButtonElement
  fireEvent.change(textarea, { target: { value: 'x'.repeat(19) } })
  expect(button.disabled).toBe(true)
  expect(screen.getByText('19/6000')).toBeTruthy()
  fireEvent.change(textarea, { target: { value: 'x'.repeat(6001) } })
  expect(textarea.value).toHaveLength(6000)
  expect(screen.getByText('6000/6000')).toBeTruthy()
  expect(button.disabled).toBe(false)
})

it('deduplicates repeated pastes using the hash fallback without Web Crypto', async () => {
  vi.stubGlobal('crypto', {})
  const client = createDemoApi({ seed: [] })
  vi.spyOn(client, 'parseAd').mockResolvedValue(example)
  const ingest = vi.spyOn(client, 'ingest')
  render(<App client={client} demo />)
  for (const message of ['1 added, 0 matches', 'Already in your feed']) {
    fireEvent.click(screen.getByRole('button', { name: 'Add from ad' }))
    paste()
    fireEvent.click(await screen.findByRole('button', { name: 'Add to feed' }))
    expect(await screen.findByText(message)).toBeTruthy()
  }
  const id = ingest.mock.calls[0][0][0].external_id
  expect(id).toMatch(/^[0-9a-f]{16}$/)
  expect(ingest.mock.calls[1][0][0].external_id).toBe(id)
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
})
