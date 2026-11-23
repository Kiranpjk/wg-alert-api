export interface SearchIn {
  label: string
  city: string
  max_rent: number
  min_size_m2?: number | null
  districts: string[]
  available_by?: string | null
}

export interface Search extends SearchIn {
  id: number
  active: boolean
  created_at: string
}

export interface ListingIn {
  source: string
  external_id: string
  url: string
  title: string
  city: string
  district?: string | null
  rent: number
  size_m2?: number | null
  available_from?: string | null
}

export interface Listing extends ListingIn {
  id: number
  received_at: string
}

export interface Match {
  id: number
  seen: boolean
  created_at: string
  listing: Listing
}

export interface IngestResult {
  created: number
  duplicates: number
  matches: number
}

export interface Api {
  health(): Promise<{ status: string }>
  listSearches(): Promise<Search[]>
  getSearch(id: number): Promise<Search>
  createSearch(search: SearchIn): Promise<Search>
  deleteSearch(id: number): Promise<void>
  ingest(listings: ListingIn[], key?: string): Promise<IngestResult>
  listMatches(id: number, unseenOnly?: boolean): Promise<Match[]>
  markSeen(id: number): Promise<{ marked_seen: number }>
}
