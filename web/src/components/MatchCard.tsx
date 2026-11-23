import type { Match } from '../types'
import { Icon } from './Icon'

export const euro = new Intl.NumberFormat('en-IE', {
  style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 2,
})
const unitEuro = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' })
const dateFormat = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' })

function utcTimestamp(value: string) {
  // SQLite can return timestamps without an offset. The API writes them in UTC.
  return /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? value : `${value}Z`
}

export function relativeTime(value: string, now = Date.now()) {
  const minutes = Math.max(0, Math.floor((now - Date.parse(utcTimestamp(value))) / 60000))
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes} min ago`
  if (minutes < 1440) return `${Math.floor(minutes / 60)} h ago`
  return `${Math.floor(minutes / 1440)} d ago`
}

function safeUrl(value: string) {
  try {
    const url = new URL(value)
    if (url.protocol === 'https:' || url.protocol === 'http:') return url.href
  } catch {
    return null
  }
  return null
}

export function MatchCard({ match }: { match: Match }) {
  const { listing, seen } = match
  const href = safeUrl(listing.url)
  return <article className="match-card">
    <div className="card-top">
      <p className="rent">{euro.format(listing.rent)} <span>warm</span></p>
      {!seen && <span className="new-badge">New</span>}
    </div>
    <div>
      <h3>{listing.title}</h3>
      <p className="card-location">{listing.district ? `${listing.district}, ` : ''}{listing.city}</p>
    </div>
    <dl className="listing-details">
      <div><dt>Size</dt><dd>{listing.size_m2 ? `${listing.size_m2} m²` : 'Unlisted'}</dd></div>
      <div><dt>Per m²</dt><dd>{listing.size_m2 ? unitEuro.format(listing.rent / listing.size_m2) : '—'}</dd></div>
      <div><dt>Move-in</dt><dd>{listing.available_from ? <time dateTime={listing.available_from}>{dateFormat.format(new Date(listing.available_from))}</time> : 'Unlisted'}</dd></div>
    </dl>
    <footer className="card-footer">
      <p>{listing.source}<br /><time dateTime={utcTimestamp(listing.received_at)} title={new Date(utcTimestamp(listing.received_at)).toLocaleString()}>{relativeTime(listing.received_at)}</time></p>
      {href && <a className="button listing-link" href={href} target="_blank" rel="noopener noreferrer">View listing <Icon name="external" /><span className="sr-only"> (opens in a new tab)</span></a>}
    </footer>
  </article>
}
