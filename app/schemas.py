from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field, HttpUrl


class SearchIn(BaseModel):
    label: str = Field(min_length=1, max_length=100)
    city: str = Field(min_length=2, max_length=80)
    max_rent: float = Field(gt=0, le=5000, description="Warm rent in EUR")
    min_size_m2: float | None = Field(default=None, gt=0, le=500)
    districts: list[str] = Field(default_factory=list, max_length=30)
    available_by: date | None = Field(default=None, description="Latest acceptable move-in date")


class SearchOut(SearchIn):
    model_config = ConfigDict(from_attributes=True)
    id: int
    active: bool
    created_at: datetime


class ListingIn(BaseModel):
    source: str = Field(min_length=1, max_length=50, examples=["studentenwerk-feed"])
    external_id: str = Field(min_length=1, max_length=100)
    url: HttpUrl
    title: str = Field(min_length=1, max_length=200)
    city: str = Field(min_length=2, max_length=80)
    district: str | None = Field(default=None, max_length=80)
    rent: float = Field(gt=0, le=10000)
    size_m2: float | None = Field(default=None, gt=0, le=1000)
    available_from: date | None = None


class ListingOut(ListingIn):
    model_config = ConfigDict(from_attributes=True)
    id: int
    url: str
    received_at: datetime


class IngestResult(BaseModel):
    created: int
    duplicates: int
    matches: int


class MatchOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    seen: bool
    created_at: datetime
    listing: ListingOut
