import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { KEY_STORAGE, readStored } from '../storage'
import type { Api, IngestResult, ParseAdResult } from '../types'
import { Dialog } from './Dialog'

const fields = [
  { name: 'title', label: 'Title', type: 'text', required: true },
  { name: 'city', label: 'City', type: 'text', required: true },
  { name: 'district', label: 'District (optional)', type: 'text' },
  { name: 'rent', label: 'Rent (EUR warm)', type: 'number', required: true },
  { name: 'size_m2', label: 'Size (m², optional)', type: 'number' },
  { name: 'available_from', label: 'Available from (optional)', type: 'date' },
  { name: 'url', label: 'Link', type: 'url', required: true },
] as const

type Field = typeof fields[number]['name']
type Values = Record<Field, string>
type Errors = Partial<Values>
const count = (value: string) => Array.from(value).length

function validate(values: Values): Errors {
  const errors: Errors = {}
  if (!values.title || count(values.title) > 200) errors.title = 'Enter a title of up to 200 characters.'
  if (count(values.city) < 2 || count(values.city) > 80) errors.city = 'Enter a city between 2 and 80 characters.'
  if (count(values.district) > 80) errors.district = 'Use up to 80 characters.'
  if (!(Number(values.rent) > 0 && Number(values.rent) <= 10000)) errors.rent = 'Enter a warm rent above €0 and up to €10,000.'
  if (values.size_m2 && !(Number(values.size_m2) > 0 && Number(values.size_m2) <= 1000)) errors.size_m2 = 'Enter a size above 0 and up to 1,000 m².'
  if (values.available_from && !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(values.available_from)) errors.available_from = 'Enter a date with a four-digit year.'
  if (!values.url) errors.url = 'Enter the ad link.'
  else if (!/^https?:\/\//i.test(values.url) || !URL.canParse(values.url) || count(values.url) > 500) {
    errors.url = 'Enter an HTTP or HTTPS link of up to 500 characters.'
  }
  return errors
}

async function adId(text: string) {
  const bytes = new TextEncoder().encode(text)
  try {
    if (globalThis.crypto?.subtle) {
      const digest = await crypto.subtle.digest('SHA-256', bytes)
      return Array.from(new Uint8Array(digest, 0, 8), (byte) => byte.toString(16).padStart(2, '0')).join('')
    }
  } catch {
    // Use the deterministic fallback if the browser cannot compute SHA-256.
  }
  let hash = 0xcbf29ce484222325n
  for (const byte of bytes) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n)
  return hash.toString(16).padStart(16, '0')
}

export function AdImport({ client, demo, onClose, onSaved }: {
  client: Api
  demo: boolean
  onClose: () => void
  onSaved: (result: IngestResult) => void
}) {
  const id = useId()
  const [text, setText] = useState('')
  const [parsed, setParsed] = useState<ParseAdResult | null>(null)
  const [values, setValues] = useState<Values | null>(null)
  const [errors, setErrors] = useState<Errors>({})
  const [failure, setFailure] = useState('')
  const [busy, setBusy] = useState(false)
  const mounted = useRef(true)
  const paste = useRef<HTMLTextAreaElement>(null)
  const title = useRef<HTMLInputElement>(null)
  const length = count(text)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  const reviewing = values !== null
  useEffect(() => {
    const frame = requestAnimationFrame(() => (reviewing ? title : paste).current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [reviewing])

  async function extract(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || length < 20 || length > 6000) return
    setBusy(true)
    setFailure('')
    try {
      const result = await client.parseAd(text)
      const draft = result.draft
      setParsed(result)
      setValues({
        title: draft.title ?? '', city: draft.city ?? '', district: draft.district ?? '',
        rent: draft.rent_kind === 'cold' ? '' : String(draft.rent ?? ''),
        size_m2: String(draft.size_m2 ?? ''), available_from: draft.available_from ?? '', url: draft.url ?? '',
      })
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'Could not extract the ad.')
    } finally {
      setBusy(false)
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !values) return
    const form = event.currentTarget
    const listing = { ...values, title: values.title.trim(), city: values.city.trim(), district: values.district.trim(), url: values.url.trim() }
    const nextErrors = validate(listing)
    for (const { name } of fields) {
      const control = form.elements.namedItem(name) as HTMLInputElement
      if (control.validity.badInput) nextErrors[name] ??= 'Enter a valid value.'
    }
    setErrors(nextErrors)
    setFailure('')
    const firstError = Object.keys(nextErrors)[0]
    if (firstError) {
      (form.elements.namedItem(firstError) as HTMLInputElement).focus()
      return
    }
    setBusy(true)
    try {
      const result = await client.ingest([{
        ...listing, source: 'pasted', external_id: await adId(text), rent: Number(listing.rent),
        size_m2: listing.size_m2 ? Number(listing.size_m2) : null,
        district: listing.district || null, available_from: listing.available_from || null,
      }], demo ? undefined : readStored(KEY_STORAGE) ?? undefined)
      if (mounted.current) onClose()
      onSaved(result)
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'Could not add the listing.')
    } finally {
      setBusy(false)
    }
  }

  function renderField(field: typeof fields[number], review: Values) {
    const inputId = id + field.name
    const error = errors[field.name]
    return <div className="field" key={field.name}>
      <label htmlFor={inputId}>{field.label}</label>
      <input id={inputId} name={field.name} type={field.type} ref={field.name === 'title' ? title : undefined}
        value={review[field.name]} step={field.type === 'number' ? 'any' : undefined} disabled={busy}
        data-empty={!review[field.name].trim() || undefined}
        required={'required' in field} aria-invalid={Boolean(error)}
        aria-describedby={error ? inputId + '-error' : undefined}
        onChange={(event) => {
          setValues({ ...review, [field.name]: event.target.value })
          setErrors({ ...errors, [field.name]: undefined })
        }} />
      {error && <p id={inputId + '-error'} className="field-error">{error}</p>}
    </div>
  }

  return <Dialog title="Add listing from pasted ad" onClose={onClose}>
    {demo && <p className="demo-banner ad-demo">Demo: this is a canned example, no AI is called.</p>}
    <div aria-live="polite" className="ad-feedback">
      {parsed && parsed.warnings.length > 0 && <ul className="ad-warnings">
        {parsed.warnings.map((warning) => <li key={warning}>{warning}</li>)}
      </ul>}
      {parsed?.draft.rent_kind === 'cold' && parsed.draft.rent !== null &&
        <p className="muted">Extracted cold rent: €{parsed.draft.rent}. Enter the warm rent below.</p>}
      {parsed && parsed.removed_contact_details > 0 &&
        <p className="muted">Contact details removed: {parsed.removed_contact_details}</p>}
    </div>
    {values && parsed ? <form className="search-form" onSubmit={save} noValidate aria-busy={busy}>
      <h3>Review listing</h3>
      {renderField(fields[0], values)}
      <div className="field-row">{fields.slice(1, 3).map((field) => renderField(field, values))}</div>
      <div className="field-row">{fields.slice(3, 5).map((field) => renderField(field, values))}</div>
      {fields.slice(5).map((field) => renderField(field, values))}
      {failure && <p className="field-error" role="alert">{failure}</p>}
      <div className="ad-actions">
        <button type="button" disabled={busy} onClick={() => { setValues(null); setParsed(null); setErrors({}); setFailure('') }}>Back</button>
        <button className="primary" type="submit" disabled={busy}>{busy ? 'Adding…' : 'Add to feed'}</button>
      </div>
    </form> : <form className="search-form" onSubmit={extract}>
      <div className="field">
        <label htmlFor={id + 'paste'}>Paste the ad</label>
        <textarea id={id + 'paste'} ref={paste} rows={8} value={text} readOnly={busy}
          aria-describedby={id + 'hint ' + id + 'count'}
          onChange={(event) => setText(Array.from(event.target.value).slice(0, 6000).join(''))} />
        <p className="muted" id={id + 'count'}>{length}/6000</p>
        <p className="muted" id={id + 'hint'}>Emails and phone numbers are removed before the text is sent to the AI.</p>
      </div>
      {busy && <p className="muted" role="status">Extracting details…</p>}
      {failure && <p className="field-error" role="alert">{failure}</p>}
      <button className="primary" type="submit" disabled={busy || length < 20}>Extract details</button>
    </form>}
  </Dialog>
}
