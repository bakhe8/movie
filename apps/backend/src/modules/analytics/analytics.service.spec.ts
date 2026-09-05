import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Repository } from 'typeorm';
import { AnalyticsEvent } from '../../entities/analytics-event.entity';
import { Consent } from '../../entities/consent.entity';
import { Profile } from '../../entities/profile.entity';
import { AnalyticsService } from './analytics.service';

describe('AnalyticsService', () => {
  let events: { insert: ReturnType<typeof vi.fn> };
  let consents: { findOne: ReturnType<typeof vi.fn> };
  let profiles: { findOne: ReturnType<typeof vi.fn> };
  let service: AnalyticsService;

  const granted = { granted: true, revokedAt: null } as Consent;

  beforeEach(() => {
    events = { insert: vi.fn().mockResolvedValue({}) };
    consents = { findOne: vi.fn().mockResolvedValue(granted) };
    profiles = { findOne: vi.fn().mockResolvedValue({ id: 'profile-1', userId: 'user-1' }) };
    service = new AnalyticsService(
      events as unknown as Repository<AnalyticsEvent>,
      consents as unknown as Repository<Consent>,
      profiles as unknown as Repository<Profile>,
    );
  });

  it('records an event for a profile that has opted in', async () => {
    await service.record('profile-1', 'triad_answered', { durationMs: 4200 });

    expect(events.insert).toHaveBeenCalledWith(
      expect.objectContaining({ profileId: 'profile-1', name: 'triad_answered', properties: { durationMs: 4200 } }),
    );
  });

  // PRIVACY.md §3: analytics_first_party is opt-in, so silence is a no.
  it.each([
    ['no consent row at all', null],
    ['a declined consent', { granted: false, revokedAt: null }],
    ['a consent that was later revoked', { granted: true, revokedAt: new Date() }],
  ])('writes nothing for %s', async (_case, consent) => {
    consents.findOne.mockResolvedValue(consent as Consent | null);

    await service.record('profile-1', 'triad_answered', { durationMs: 1 });

    expect(events.insert).not.toHaveBeenCalled();
  });

  // ADR-107: the canary runs the same onboarding and grants the same
  // consents every six hours; without this its journey would be counted as
  // twenty real users a week in every reported funnel.
  it('writes nothing for a canary account, consent or not', async () => {
    profiles.findOne.mockResolvedValue({ id: 'profile-1', userId: 'canary-user', user: { id: 'canary-user', isCanary: true } });

    await service.record('profile-1', 'triad_answered', { durationMs: 1 });

    expect(events.insert).not.toHaveBeenCalled();
  });

  it('writes nothing for a profile that no longer exists', async () => {
    profiles.findOne.mockResolvedValue(null);

    await service.record('profile-1', 'triad_answered');

    expect(events.insert).not.toHaveBeenCalled();
  });

  // An anonymous funnel step has no profile to identify and no consent to
  // ask for -- it is a count, not a person.
  it('records a profile-less event without looking for a consent', async () => {
    await service.record(null, 'onboarding_started');

    expect(consents.findOne).not.toHaveBeenCalled();
    expect(events.insert).toHaveBeenCalledWith(expect.objectContaining({ profileId: null }));
  });

  describe('property sanitising', () => {
    const propertiesOf = () => events.insert.mock.calls[0][0].properties as Record<string, unknown>;

    // The whole reason the column is not free-form: an object or an array is
    // how prose, emails and ids end up in an analytics table for good.
    it('drops anything that is not a number, a short string or a boolean', async () => {
      await service.record('profile-1', 'watch_marked', {
        durationMs: 12,
        outcome: 'watched',
        wasFirst: true,
        note: 'x'.repeat(33),
        nested: { email: 'a@b.c' },
        list: [1, 2],
        nothing: null,
        notANumber: Number.NaN,
        empty: '',
      } as never);

      expect(propertiesOf()).toEqual({ durationMs: 12, outcome: 'watched', wasFirst: true });
    });

    it('stops after twelve properties rather than accepting an unbounded blob', async () => {
      const many = Object.fromEntries(Array.from({ length: 40 }, (_, index) => [`p${index}`, index]));

      await service.record('profile-1', 'watch_marked', many);

      expect(Object.keys(propertiesOf())).toHaveLength(12);
    });
  });

  // Analytics that can fail a rank would be worse than no analytics.
  it('never lets a failed write escape into the request it is measuring', async () => {
    events.insert.mockRejectedValue(new Error('db down'));

    await expect(service.record('profile-1', 'triad_answered')).resolves.toBeUndefined();
  });

  describe('occurredAt', () => {
    const stampedAt = () => events.insert.mock.calls[0][0].occurredAt as Date;

    it('keeps a caller-supplied time, so an offline round is not stamped on arrival', async () => {
      const occurredAt = new Date(Date.now() - 60_000);

      await service.record('profile-1', 'triad_answered', {}, occurredAt);

      expect(stampedAt()).toBe(occurredAt);
    });

    // A wrong device clock must not write into a window already reported on,
    // but the event did happen -- so it is re-stamped, never dropped.
    it.each([
      ['a time in the future', () => new Date(Date.now() + 60 * 60_000)],
      ['a time older than the backdating window', () => new Date(Date.now() - 8 * 24 * 60 * 60_000)],
      ['an unparseable date', () => new Date('nonsense')],
    ])('replaces %s with now', async (_case, build) => {
      const before = Date.now();

      await service.record('profile-1', 'triad_answered', {}, build());

      expect(events.insert).toHaveBeenCalledOnce();
      expect(stampedAt().getTime()).toBeGreaterThanOrEqual(before);
      expect(stampedAt().getTime()).toBeLessThanOrEqual(Date.now());
    });
  });
});
