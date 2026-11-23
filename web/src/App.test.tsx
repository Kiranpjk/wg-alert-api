import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import App from './App'
import { createDemoApi } from './demo/demoApi'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.localStorage.clear()
})

it('creates a demo search, ingests the feed, marks matches seen and can still show them', async () => {
  const client = createDemoApi({ seed: [] })
  const ingest = vi.spyOn(client, 'ingest')
  render(<App client={client} demo />)
  expect(screen.getByText('Demo mode: data lives in your browser')).toBeTruthy()
  await screen.findByText('No searches yet')
  fireEvent.click(within(screen.getByRole('main')).getByRole('button', { name: 'New search' }))
  const form = within(screen.getByRole('dialog', { name: 'New search' }))
  fireEvent.change(form.getByLabelText('Search name'), { target: { value: 'Near campus' } })
  fireEvent.change(form.getByLabelText('City'), { target: { value: 'Jena' } })
  fireEvent.change(form.getByLabelText('Max. warm rent (€)'), { target: { value: '500' } })
  fireEvent.click(form.getByRole('button', { name: 'Save search' }))
  await screen.findByText('No matches yet')
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
  fireEvent.click(screen.getByRole('button', { name: 'Ingest sample feed' }))
  await screen.findByText(/15 created, 0 duplicates, 5 matches/)
  expect(ingest).toHaveBeenCalledTimes(3)
  expect(screen.getAllByRole('article')).toHaveLength(5)
  fireEvent.click(screen.getByRole('button', { name: 'Mark all seen' }))
  await screen.findByText('All caught up')
  fireEvent.click(screen.getByRole('button', { name: 'Show seen matches' }))
  expect(screen.getAllByRole('article')).toHaveLength(5)
  expect(screen.queryByText('New', { exact: true })).toBeNull()
})

it('rolls back a failed optimistic mark and retries', async () => {
  const client = createDemoApi()
  const search = await client.createSearch({ label: 'Jena', city: 'Jena', max_rent: 500, districts: [] })
  const realMarkSeen = client.markSeen
  let reject!: (reason: Error) => void
  vi.spyOn(client, 'markSeen')
    .mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail }))
    .mockImplementation(realMarkSeen)
  render(<App client={client} demo />)
  await screen.findByRole('article')
  fireEvent.click(screen.getByRole('button', { name: 'Mark all seen' }))
  expect(screen.getByText('All caught up')).toBeTruthy()
  reject(new Error('Connection lost.'))
  await screen.findByRole('article')
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await waitFor(async () => expect(await client.listMatches(search.id, true)).toEqual([]))
})

it('requires delete confirmation and returns to the empty state', async () => {
  const client = createDemoApi()
  await client.createSearch({ label: 'Jena', city: 'Jena', max_rent: 500, districts: [] })
  render(<App client={client} demo />)
  fireEvent.click(await screen.findByRole('button', { name: 'Delete search' }))
  fireEvent.click(screen.getByRole('button', { name: 'Keep search' }))
  expect(await client.listSearches()).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: 'Delete search' }))
  fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }))
  await screen.findByText('No searches yet')
  expect(await client.listSearches()).toEqual([])
})

it('asks for the API key when the server answers 401', async () => {
  const client = createDemoApi({ seed: [] })
  vi.spyOn(client, 'listSearches').mockRejectedValue(Object.assign(new Error('invalid or missing X-API-Key'), { status: 401 }))
  render(<App client={client} demo={false} />)
  await screen.findByText('API key needed')
  fireEvent.click(screen.getByRole('button', { name: 'Open Settings' }))
  expect(screen.getByRole('dialog', { name: 'Settings' })).toBeTruthy()
})
