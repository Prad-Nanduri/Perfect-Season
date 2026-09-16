'use client';

import { useState } from 'react';
import { LockKey } from '@phosphor-icons/react';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { Badge } from '../ui/badge';
import type { DraftCandidate } from './types';
import Image from 'next/image';

export function CandidateCard({
  candidate,
  franchise,
  selected,
  onSelect,
}: {
  candidate: DraftCandidate;
  franchise: { name: string; logoUrl: string | null } | null;
  selected: boolean;
  onSelect: () => void;
}) {
  const draggable = useDraggable({ id: candidate.playerId, data: { candidate } });
  // Fixture/demo assets (e.g. example.com logo URLs) can fail to load — fall
  // back to initials instead of a broken image icon.
  const [headshotFailed, setHeadshotFailed] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);
  const style = draggable.transform
    ? { transform: CSS.Translate.toString(draggable.transform) }
    : undefined;
  return (
    <button
      ref={draggable.setNodeRef}
      type="button"
      style={style}
      {...draggable.attributes}
      {...draggable.listeners}
      onClick={onSelect}
      className={`flex w-full min-w-0 touch-pan-y items-center gap-3 rounded-control border bg-surface p-3 text-left transition-colors ${
        selected ? 'border-sport bg-sport/10' : 'border-line hover:border-sport/60'
      }`}
      aria-label={`${candidate.fullName}, ${candidate.primaryPosition}`}
    >
      {candidate.headshotUrl && !headshotFailed ? (
        <Image
          src={candidate.headshotUrl}
          alt=""
          width={40}
          height={40}
          loading="lazy"
          unoptimized
          onError={() => setHeadshotFailed(true)}
          className="h-10 w-10 rounded-full object-cover"
        />
      ) : (
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-subtle text-caption font-bold">
          {candidate.fullName.slice(0, 1)}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-small font-bold">{candidate.fullName}</span>
        <span className="flex items-center gap-1.5 text-caption text-muted">
          {franchise?.logoUrl && !logoFailed ? (
            <Image
              src={franchise.logoUrl}
              alt={franchise.name}
              width={16}
              height={16}
              unoptimized
              onError={() => setLogoFailed(true)}
              className="h-4 w-4 object-contain"
            />
          ) : null}
          {candidate.primaryPosition}
          {candidate.badges?.map((badge) => (
            <Badge key={badge} tone="neutral">
              {badge}
            </Badge>
          ))}
        </span>
      </span>
      {candidate.rating === null ? (
        <Badge tone="neutral">
          <LockKey size={13} aria-hidden="true" />
          Hidden
        </Badge>
      ) : (
        <span
          className={`font-display text-title font-extrabold leading-none tabular-nums ${
            candidate.rating >= 90 ? 'text-sport' : 'text-ink'
          }`}
          aria-label={`Rating ${candidate.rating}`}
        >
          {candidate.rating}
        </span>
      )}
    </button>
  );
}
