"""Pure matching rules, kept free of database code so they are easy to unit test."""

from __future__ import annotations

from typing import Protocol


def _norm(text: str | None) -> str:
    return (text or "").strip().casefold()


class SearchLike(Protocol):
    city: str
    max_rent: float
    min_size_m2: float | None
    districts: list[str]
    available_by: object


class ListingLike(Protocol):
    city: str
    district: str | None
    rent: float
    size_m2: float | None
    available_from: object


def matches(search: SearchLike, listing: ListingLike) -> bool:
    if _norm(search.city) != _norm(listing.city):
        return False
    if listing.rent > search.max_rent:
        return False
    # A listing without a size is kept: better a false positive than a missed room.
    if search.min_size_m2 and listing.size_m2 and listing.size_m2 < search.min_size_m2:
        return False
    if search.districts:
        wanted = {_norm(d) for d in search.districts}
        if _norm(listing.district) not in wanted:
            return False
    if search.available_by and listing.available_from:
        if listing.available_from > search.available_by:
            return False
    return True
