import { useCallback, useEffect, useRef, useState } from 'react'
import { api, isDemo } from './api'
import { demoListings } from './demo/demoApi'
import { AdImport } from './components/AdImport'
import { Dialog } from './components/Dialog'
import { Icon } from './components/Icon'
import { euro, MatchCard } from './components/MatchCard'
import { SearchForm } from './components/SearchForm'
import { Settings } from './components/Settings'
import { visibleMatches, type Sort } from './matchView'
import { useTheme } from './theme'
import type { Api, Match, Search, SearchIn } from './types'

type Panel = 'new' | 'settings' | 'drawer' | 'ad' | null
type Notice = { message: string; retry?: () => void }
type Dashboard = { searches: Search[]; matches: Record<number, Match[]> }
const emptyDashboard: Dashboard = { searches: [], matches: {} }
const pollMs = 15_000

function errorMessage(prefix: string, error: unknown) {
  return error instanceof Error && error.message !== 'Failed to fetch' ? `${prefix} ${error.message}` : prefix
}

export default function App({ client = api, demo = isDemo }: { client?: Api; demo?: boolean }) {
  const { theme, toggle } = useTheme()
  const [data, setData] = useState(emptyDashboard)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [needsKey, setNeedsKey] = useState(false)
  const [selected, setSelected] = useState<number | null>(null)
  const [panel, setPanel] = useState<Panel>(null)
  const [health, setHealth] = useState<boolean | null>(null)
  const [unseenOnly, setUnseenOnly] = useState(true)
  const [sort, setSort] = useState<Sort>('newest')
  const [confirmId, setConfirmId] = useState<number | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [ingesting, setIngesting] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const sequence = useRef(0)
  const mutation = useRef(false)
  const drawerButton = useRef<HTMLButtonElement>(null)
  const title = useRef<HTMLHeadingElement>(null)
  const confirmButton = useRef<HTMLButtonElement>(null)
  const deleteButton = useRef<HTMLButtonElement>(null)
  const returnToDrawer = useRef(false)

  const refresh = useCallback(async (report = true) => {
    if (mutation.current) return
    const requestId = ++sequence.current
    try {
      const searches = await client.listSearches()
      const entries = await Promise.all(searches.map(async (search) => {
        try {
          return [search.id, await client.listMatches(search.id)] as const
        } catch (error) {
          if (typeof error === 'object' && error !== null && 'status' in error && error.status === 404) return null
          throw error
        }
      }))
      if (requestId !== sequence.current) return
      const matches = Object.fromEntries(entries.filter((entry) => entry !== null))
      setData({ searches: searches.filter((search) => search.id in matches), matches })
      setFailed(false)
      setNeedsKey(false)
      setNotice((previous) => previous?.retry === refresh ? null : previous)
    } catch (error) {
      if (requestId !== sequence.current) return
      setFailed(true)
      const unauthorized = typeof error === 'object' && error !== null && 'status' in error && error.status === 401
      setNeedsKey(unauthorized)
      if (report && !unauthorized) setNotice({ message: errorMessage('Could not load searches and matches.', error), retry: refresh })
    } finally {
      if (requestId === sequence.current) setLoading(false)
    }
  }, [client])

  useEffect(() => {
    let active = true
    async function pollHealth() {
      try {
        const result = await client.health()
        if (active) setHealth(result.status === 'ok')
      } catch {
        if (active) setHealth(false)
      }
    }
    void pollHealth()
    void refresh()
    const timer = window.setInterval(() => {
      void pollHealth()
      void refresh(false)
    }, pollMs)
    return () => {
      active = false
      sequence.current++
      window.clearInterval(timer)
    }
  }, [client, refresh])

  useEffect(() => {
    const desktop = window.matchMedia?.('(min-width: 800px)')
    const closeDrawer = () => {
      if (desktop.matches) setPanel((current) => current === 'drawer' ? null : current)
    }
    desktop?.addEventListener('change', closeDrawer)
    return () => desktop?.removeEventListener('change', closeDrawer)
  }, [])

  useEffect(() => {
    if (confirmId !== null) confirmButton.current?.focus()
  }, [confirmId])

  const search = data.searches.find((item) => item.id === selected) ?? data.searches[0]
  const matches = search ? data.matches[search.id] ?? [] : []
  const unseenCount = matches.filter((match) => !match.seen).length
  const visible = visibleMatches(matches, unseenOnly, sort)

  function closePanel() {
    setPanel(null)
    if (returnToDrawer.current) {
      returnToDrawer.current = false
      requestAnimationFrame(() => drawerButton.current?.focus())
    }
  }

  function chooseSearch(id: number) {
    setSelected(id)
    setConfirmId(null)
    if (panel === 'drawer') {
      setPanel(null)
      requestAnimationFrame(() => title.current?.focus())
    }
  }

  async function createSearch(input: SearchIn) {
    const created = await client.createSearch(input)
    sequence.current++
    setData((current) => current.searches.some((item) => item.id === created.id)
      ? current : { ...current, searches: [...current.searches, created] })
    setSelected(created.id)
    setConfirmId(null)
    closePanel()
    await refresh()
  }

  async function markSeen(id: number) {
    if (mutation.current) return
    mutation.current = true
    sequence.current++
    setBusyId(id)
    const previous = data.matches[id] ?? []
    setData((current) => ({
      ...current, matches: { ...current.matches, [id]: previous.map((match) => ({ ...match, seen: true })) },
    }))
    try {
      await client.markSeen(id)
      setNotice({ message: 'Marked all matches as seen.' })
    } catch (error) {
      setData((current) => ({ ...current, matches: { ...current.matches, [id]: previous } }))
      setNotice({ message: errorMessage('Could not mark matches as seen.', error), retry: () => void markSeen(id) })
    } finally {
      mutation.current = false
      setBusyId(null)
      await refresh(false)
    }
  }

  async function deleteSearch(id: number) {
    if (mutation.current) return
    mutation.current = true
    sequence.current++
    setBusyId(id)
    try {
      await client.deleteSearch(id)
      setData((current) => {
        const matches = { ...current.matches }
        delete matches[id]
        return { searches: current.searches.filter((item) => item.id !== id), matches }
      })
      setSelected((current) => current === id ? null : current)
      setConfirmId(null)
      setNotice({ message: 'Search deleted.' })
      requestAnimationFrame(() => title.current?.focus())
    } catch (error) {
      setNotice({ message: errorMessage('Could not delete the search.', error), retry: () => void deleteSearch(id) })
    } finally {
      mutation.current = false
      setBusyId(null)
      await refresh(false)
    }
  }

  async function ingest(key: string) {
    if (ingesting) return
    setIngesting(true)
    closePanel()
    setNotice({ message: 'Ingesting sample feed…' })
    const batches = demo ? [demoListings.slice(0, 5), demoListings.slice(5, 10), demoListings.slice(10)] : [demoListings]
    const total = { created: 0, duplicates: 0, matches: 0 }
    try {
      for (const [index, batch] of batches.entries()) {
        if (index) await new Promise((resolve) => window.setTimeout(resolve, 450))
        const result = await client.ingest(batch, demo ? undefined : key)
        total.created += result.created
        total.duplicates += result.duplicates
        total.matches += result.matches
        await refresh(false)
      }
      setNotice({ message: `Sample feed processed. ${total.created} created, ${total.duplicates} duplicates, ${total.matches} matches.` })
    } catch (error) {
      setNotice({ message: errorMessage('Could not ingest the sample feed.', error), retry: () => {
        if (demo) void ingest('')
        else setPanel('settings')
      } })
    } finally {
      setIngesting(false)
    }
  }

  function renderIndex(inDrawer = false) {
    return <nav aria-label="Saved searches" className="search-index">
      {!inDrawer && <h2>Saved searches</h2>}
      <button className="primary new-search" onClick={() => {
        returnToDrawer.current = inDrawer
        setPanel('new')
      }}><Icon name="plus" /> New search</button>
      {data.searches.length > 0 && <ul>
        {data.searches.map((item) => {
          const count = data.matches[item.id]?.filter((match) => !match.seen).length ?? 0
          return <li key={item.id}>
            <button className="index-item" aria-current={item.id === search?.id ? 'true' : undefined}
              onClick={() => chooseSearch(item.id)}>
              <span><strong>{item.label}</strong><small>{item.city} · up to {euro.format(item.max_rent)}</small></span>
              <span className="count" aria-label={`${count} unseen matches`}>{count}</span>
            </button>
          </li>
        })}
      </ul>}
      {loading && <div className="index-skeleton" aria-hidden="true" />}
      {!loading && !failed && !data.searches.length && <p className="muted">Your saved searches will appear here.</p>}
    </nav>
  }

  return <>
    <a className="skip-link" href="#matches">Skip to matches</a>
    <header className="topbar">
      <div className="brand">
        <button ref={drawerButton} className="icon-button mobile-menu" aria-label="Open saved searches" aria-haspopup="dialog"
          onClick={() => setPanel('drawer')}><Icon name="menu" /></button>
        <span className="brand-icon"><Icon name="home" /></span>
        <span>WG Alert</span>
      </div>
      <div className="top-actions">
        <span className="health" role="status"><span className={health ? 'online-dot online' : 'online-dot'} />
          {health === null ? 'Checking API' : health ? 'API online' : 'API offline'}
        </span>
        <button className="icon-button" onClick={toggle} aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}><Icon name="theme" /></button>
        <button className="add-ad-button" onClick={() => setPanel('ad')} aria-haspopup="dialog">Add from ad</button>
        <button className="settings-button" onClick={() => setPanel('settings')} aria-label="Settings" aria-haspopup="dialog"><Icon name="settings" /><span>Settings</span></button>
      </div>
    </header>
    {demo && <p className="demo-banner">Demo mode: data lives in your browser</p>}
    <div className="workspace">
      <aside>{renderIndex()}</aside>
      <main id="matches" className="main-pane" tabIndex={-1} aria-busy={loading}>
        {search ? <>
          <header className="search-header">
            <h1 ref={title} tabIndex={-1}>{search.label}</h1>
            <p className="search-summary">{search.city} · up to {euro.format(search.max_rent)} warm
              {search.min_size_m2 ? ` · ${search.min_size_m2} m² minimum` : ''}
              {search.districts.length > 0 ? ` · ${search.districts.join(', ')}` : ''}
            </p>
          </header>
          <section className="matches-section" aria-labelledby="matches-heading">
            <div className="section-heading">
              <h2 id="matches-heading">Room matches</h2>
              <span className="muted" aria-live="polite">{visible.length} shown · {unseenCount} new</span>
            </div>
            <div className="toolbar">
              <label className="check-label"><input type="checkbox" checked={unseenOnly} onChange={(event) => setUnseenOnly(event.target.checked)} /> Unseen only</label>
              <label className="sort-label">Sort by <select value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
                <option value="newest">Newest</option><option value="rent">Lowest rent</option><option value="value">Best EUR/m²</option>
              </select></label>
              <button disabled={!unseenCount || busyId !== null} onClick={() => void markSeen(search.id)}><Icon name="check" /> Mark all seen</button>
              <button ref={deleteButton} className="delete-button" disabled={busyId !== null} onClick={() => setConfirmId(search.id)}>Delete search</button>
            </div>
            {confirmId === search.id && <div className="inline-confirm" role="group" aria-label="Confirm deletion">
              <p>Delete “{search.label}” and its match history?</p>
              <button ref={confirmButton} disabled={busyId !== null} onClick={() => {
                setConfirmId(null)
                requestAnimationFrame(() => deleteButton.current?.focus())
              }}>Keep search</button>
              <button className="primary" disabled={busyId !== null} onClick={() => void deleteSearch(search.id)}>Confirm delete</button>
            </div>}
            {visible.length ? <div className="match-grid">
              {visible.map((match) => <MatchCard key={match.id} match={match} />)}
            </div> : <section className="empty">
              <h3>{matches.length && unseenOnly ? 'All caught up' : 'No matches yet'}</h3>
              <p>{matches.length && unseenOnly
                ? 'New rooms will appear here as they arrive.'
                : 'Rooms that fit this search will appear as listings arrive.'}</p>
              {matches.length > 0 && unseenOnly && <button onClick={() => setUnseenOnly(false)}>Show seen matches</button>}
              <button onClick={() => setPanel('ad')} aria-haspopup="dialog">Add from ad</button>
              {demo && matches.length === 0 && <button onClick={() => setPanel('settings')}>Open sample feed settings</button>}
            </section>}
          </section>
        </> : <>
          <header className="search-header">
            <h1 ref={title} tabIndex={-1}>Your room searches</h1>
            <p className="search-summary">Keep track of rooms that fit your budget and plans.</p>
          </header>
          {loading ? <div className="match-grid skeleton-grid" role="status" aria-label="Loading searches"><div /><div /><div /></div>
            : <section className="empty">
              <h2>{needsKey ? 'API key needed' : failed ? 'Searches are unavailable' : 'No searches yet'}</h2>
              <p>{needsKey ? 'This server asks for an API key. Open Settings and enter the INGEST_API_KEY from your .env file.'
                : failed ? 'Check the connection and try loading your searches again.'
                : 'Save a search with your city and warm rent budget to start finding matches.'}</p>
              {needsKey ? <button className="primary" onClick={() => setPanel('settings')}>Open Settings</button>
                : failed ? <button onClick={() => void refresh()}>Retry</button>
                : <button className="primary" onClick={() => setPanel('new')}><Icon name="plus" /> New search</button>}
            </section>}
        </>}
      </main>
    </div>
    <div className="toast-region" aria-live="polite" aria-atomic="true">
      {notice && <div className="toast">
        <p>{notice.message}</p>
        {notice.retry && <button onClick={() => { setNotice(null); notice.retry?.() }}>Retry</button>}
        <button className="icon-button" aria-label="Dismiss notification" onClick={() => setNotice(null)}><Icon name="close" /></button>
      </div>}
    </div>
    {panel === 'ad' && <AdImport client={client} demo={demo} onClose={closePanel} onSaved={(result) => {
      setNotice({ message: result.duplicates ? 'Already in your feed' : `${result.created} added, ${result.matches} matches` })
      void refresh(false)
    }} />}
    {panel === 'drawer' && <Dialog key="drawer" title="Saved searches" drawer onClose={closePanel}>{renderIndex(true)}</Dialog>}
    {panel === 'new' && <Dialog key="new" title="New search" onClose={closePanel}><SearchForm onSave={createSearch} /></Dialog>}
    {panel === 'settings' && <Dialog key="settings" title="Settings" onClose={closePanel}><Settings demo={demo} ingesting={ingesting} onIngest={(key) => void ingest(key)} /></Dialog>}
  </>
}
