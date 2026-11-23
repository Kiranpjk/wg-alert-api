import { useId, useState, type FormEvent } from 'react'
import { ApiError } from '../api'
import type { SearchIn } from '../types'
import { Icon } from './Icon'

const fields = [
  { name: 'label', label: 'Search name', type: 'text', placeholder: 'e.g. Near campus' },
  { name: 'city', label: 'City', type: 'text', placeholder: 'e.g. Jena' },
  { name: 'max_rent', label: 'Max. warm rent (€)', type: 'number', placeholder: '500' },
  { name: 'min_size_m2', label: 'Min. size (m², optional)', type: 'number', placeholder: '12' },
  { name: 'available_by', label: 'Move in by (optional)', type: 'date' },
] as const

type Field = typeof fields[number]['name']
type Values = Record<Field, string>
type Errors = Partial<Record<Field | 'districts', string>>
const initial: Values = { label: '', city: '', max_rent: '', min_size_m2: '', available_by: '' }

export function validateSearch(values: Values, districts: string[]): Errors {
  const errors: Errors = {}
  const labelLength = Array.from(values.label.trim()).length
  const cityLength = Array.from(values.city.trim()).length
  if (labelLength < 1 || labelLength > 100) errors.label = 'Enter a name between 1 and 100 characters.'
  if (cityLength < 2 || cityLength > 80) errors.city = 'Enter a city between 2 and 80 characters.'
  if (!(Number(values.max_rent) > 0 && Number(values.max_rent) <= 5000)) errors.max_rent = 'Enter a rent above €0 and up to €5,000.'
  if (values.min_size_m2 && !(Number(values.min_size_m2) > 0 && Number(values.min_size_m2) <= 500)) errors.min_size_m2 = 'Enter a size above 0 and up to 500 m².'
  if (districts.length > 30) errors.districts = 'Use up to 30 districts.'
  if (values.available_by && !/^\d{4}-\d{2}-\d{2}$/.test(values.available_by)) errors.available_by = 'Enter a date with a four-digit year.'
  return errors
}

export function SearchForm({ onSave }: { onSave: (input: SearchIn) => Promise<void> }) {
  const prefix = useId()
  const [values, setValues] = useState(initial)
  const [districts, setDistricts] = useState<string[]>([])
  const [draft, setDraft] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const [failure, setFailure] = useState('')
  const [saving, setSaving] = useState(false)
  const withDraft = (value: string) => [...new Set([...districts, ...value.split(',').map((item) => item.trim()).filter(Boolean)])]

  function addDistricts(value: string) {
    const next = withDraft(value)
    if (next.length > 30) {
      setDraft(value)
      setErrors((previous) => ({ ...previous, districts: 'Use up to 30 districts.' }))
      return
    }
    setDistricts(next)
    setDraft('')
    setErrors((previous) => ({ ...previous, districts: undefined }))
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    const form = event.currentTarget
    const nextDistricts = withDraft(draft)
    const nextErrors = validateSearch(values, nextDistricts)
    for (const field of fields) {
      const control = form.elements.namedItem(field.name) as HTMLInputElement
      if (control.validity.badInput) nextErrors[field.name] ??= 'Enter a valid value.'
    }
    setErrors(nextErrors)
    setFailure('')
    const firstError = Object.keys(nextErrors)[0]
    if (firstError) {
      (form.elements.namedItem(firstError) as HTMLInputElement | null)?.focus()
      return
    }
    setSaving(true)
    try {
      await onSave({
        label: values.label.trim(), city: values.city.trim(), max_rent: Number(values.max_rent),
        min_size_m2: values.min_size_m2 ? Number(values.min_size_m2) : null,
        districts: nextDistricts, available_by: values.available_by || null,
      })
    } catch (error) {
      if (error instanceof ApiError && error.status === 422) setErrors(error.fields)
      setFailure(error instanceof Error ? error.message : 'Could not save the search.')
    } finally {
      setSaving(false)
    }
  }

  const renderField = (field: typeof fields[number]) => {
    const id = prefix + field.name
    return <div className="field" key={field.name}>
      <label htmlFor={id}>{field.label}</label>
      <input id={id} name={field.name} type={field.type} step={field.type === 'number' ? 'any' : undefined}
        placeholder={'placeholder' in field ? field.placeholder : undefined} value={values[field.name]}
        aria-required={['label', 'city', 'max_rent'].includes(field.name) || undefined}
        aria-invalid={Boolean(errors[field.name])} aria-describedby={errors[field.name] ? id + '-error' : undefined}
        onChange={(event) => {
          setValues({ ...values, [field.name]: event.target.value })
          setErrors({ ...errors, [field.name]: undefined })
        }} />
      {errors[field.name] && <p id={id + '-error'} className="field-error">{errors[field.name]}</p>}
    </div>
  }

  return <form className="search-form" onSubmit={submit} noValidate>
    {fields.slice(0, 2).map(renderField)}
    <div className="field-row">{fields.slice(2, 4).map(renderField)}</div>
    <div className="field">
      <label htmlFor={prefix + 'districts'}>Districts (optional)</label>
      {districts.length > 0 && <ul className="chips" aria-label="Selected districts">
        {districts.map((district) => <li key={district}>
          {district}<button type="button" aria-label={`Remove ${district}`}
            onClick={() => setDistricts(districts.filter((item) => item !== district))}><Icon name="close" /></button>
        </li>)}
      </ul>}
      <input id={prefix + 'districts'} name="districts" value={draft} placeholder="e.g. Zentrum"
        aria-invalid={Boolean(errors.districts)} aria-describedby={prefix + 'district-help'}
        onChange={(event) => {
          const value = event.target.value
          if (value.includes(',')) addDistricts(value)
          else setDraft(value)
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return
          if (event.key === 'Enter' || event.key === ',') {
            event.preventDefault()
            addDistricts(draft)
          } else if (event.key === 'Backspace' && !draft) {
            setDistricts(districts.slice(0, -1))
            setErrors({ ...errors, districts: undefined })
          }
        }} />
      <p id={prefix + 'district-help'} className={errors.districts ? 'field-error' : 'muted'}>
        {errors.districts ?? 'Press Enter or comma to add a district.'}
      </p>
    </div>
    {renderField(fields[4])}
    {failure && <p className="field-error" role="alert">{failure}</p>}
    <button className="primary" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save search'}</button>
  </form>
}
