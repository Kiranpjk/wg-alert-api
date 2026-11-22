from __future__ import annotations

import os
from datetime import UTC, date, datetime

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    create_engine,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, sessionmaker
from sqlalchemy.pool import StaticPool


def utcnow() -> datetime:
    return datetime.now(UTC)


class Base(DeclarativeBase):
    pass


class Search(Base):
    __tablename__ = "searches"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    label: Mapped[str] = mapped_column(String(100))
    city: Mapped[str] = mapped_column(String(80), index=True)
    max_rent: Mapped[float] = mapped_column(Float)
    min_size_m2: Mapped[float | None] = mapped_column(Float, nullable=True)
    districts: Mapped[list[str]] = mapped_column(JSON, default=list)
    available_by: Mapped[date | None] = mapped_column(Date, nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    matches: Mapped[list[Match]] = relationship(back_populates="search", cascade="all, delete")


class Listing(Base):
    __tablename__ = "listings"
    __table_args__ = (UniqueConstraint("source", "external_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source: Mapped[str] = mapped_column(String(50))
    external_id: Mapped[str] = mapped_column(String(100))
    url: Mapped[str] = mapped_column(String(500))
    title: Mapped[str] = mapped_column(String(200))
    city: Mapped[str] = mapped_column(String(80), index=True)
    district: Mapped[str | None] = mapped_column(String(80), nullable=True)
    rent: Mapped[float] = mapped_column(Float)
    size_m2: Mapped[float | None] = mapped_column(Float, nullable=True)
    available_from: Mapped[date | None] = mapped_column(Date, nullable=True)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Match(Base):
    __tablename__ = "matches"
    __table_args__ = (UniqueConstraint("search_id", "listing_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    search_id: Mapped[int] = mapped_column(ForeignKey("searches.id", ondelete="CASCADE"))
    listing_id: Mapped[int] = mapped_column(ForeignKey("listings.id", ondelete="CASCADE"))
    seen: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    search: Mapped[Search] = relationship(back_populates="matches")
    listing: Mapped[Listing] = relationship()


def make_engine(url: str | None = None):
    url = url or os.getenv("DATABASE_URL", "sqlite:///./wg_alert.db")
    if url.startswith("sqlite"):
        kwargs: dict = {"connect_args": {"check_same_thread": False}}
        if url in ("sqlite://", "sqlite:///:memory:"):
            kwargs["poolclass"] = StaticPool
        return create_engine(url, **kwargs)
    return create_engine(url, pool_pre_ping=True)


def make_sessionmaker(engine) -> sessionmaker:
    return sessionmaker(bind=engine, expire_on_commit=False)
