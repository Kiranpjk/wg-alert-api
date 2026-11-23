import { useState } from 'react'
import { readStored, writeStored } from '../storage'

const storageKey = 'wg-alert:ingest-key'

export function Settings({ demo, ingesting, onIngest }: {
  demo: boolean
  ingesting: boolean
  onIngest: (key: string) => void
}) {
  const [key, setKey] = useState(() => demo ? '' : readStored(storageKey) ?? '')
  const [notice, setNotice] = useState('')
  return <div className="settings">
    {!demo && <form onSubmit={(event) => {
      event.preventDefault()
      setNotice(writeStored(storageKey, key) ? 'API key saved.' : 'Browser storage is unavailable. You can still use the key in this dialog.')
    }}>
      <div className="field">
        <label htmlFor="ingest-key">Ingest API key</label>
        <input id="ingest-key" type="password" autoComplete="off" value={key} onChange={(event) => {
          setKey(event.target.value)
          setNotice('')
        }} />
      </div>
      <button type="submit">Save key</button>
      <p role="status" className="muted">{notice}</p>
    </form>}
    <section className="feed-settings" aria-labelledby="sample-heading">
      <h3 id="sample-heading">Sample feed</h3>
      <p className="muted">{demo ? 'Send fictional rooms to your saved searches in three batches.' : 'Send the bundled fictional listings to your API.'}</p>
      <button className="primary" disabled={ingesting} onClick={() => onIngest(key)}>
        {ingesting ? 'Ingesting…' : 'Ingest sample feed'}
      </button>
    </section>
  </div>
}
