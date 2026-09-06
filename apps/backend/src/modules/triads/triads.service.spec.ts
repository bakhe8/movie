import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { PosterService } from '../public-quality/poster.service';
import { TRIAD_POLICY_EXPERIMENT, type ExperimentsService } from '../experiments/experiments.service';
import { UserModelSnapshot } from '../../entities/user-model-snapshot.entity';
import type { TriadPolicyService } from './triad-policy.service';
import type { Repository } from 'typeorm';
import { Outcome } from '../../entities/outcome.entity';
import { Profile } from '../../entities/profile.entity';
import { Recommendation } from '../../entities/recommendation.entity';
import { Title } from '../../entities/title.entity';
import { Triad } from '../../entities/triad.entity';
import { TriadReplacement } from '../../entities/triad-replacement.entity';
import { UserTitleState } from '../../entities/user-title-state.entity';
import { WatchEvent } from '../../entities/watch-event.entity';
import { triadSetHash } from './triad-set';
import { TriadsService } from './triads.service';

function repoMock() {
  // `manager.transaction(run)` hands `run` the same manager mock, so a test
  // can assert every write that happened inside the transaction.
  const manager = {
    findOne: vi.fn(),
    // completedSetHashes(profileId, manager) reads this inside replace()'s
    // transaction; empty by default so tests that don't care about set
    // history see no prior sets.
    find: vi.fn(async () => []),
    count: vi.fn(),
    save: vi.fn(async (entity: unknown) => entity),
    create: vi.fn((_target: unknown, data: unknown) => data),
    transaction: vi.fn(async (run: (manager: unknown) => Promise<unknown>) => run(manager)),
  };
  return {
    findOne: vi.fn(),
    // Defaults to an empty result so the items lookup in withItems() (a
    // titlesRepository.find) never trips a test that isn't about it.
    find: vi.fn(async () => []),
    count: vi.fn(),
    save: vi.fn(async (entity: unknown) => entity),
    create: vi.fn((data: unknown) => data),
    manager,
  };
}

describe('TriadsService', () => {
  let posterService: { attach: ReturnType<typeof vi.fn>; forTitles: ReturnType<typeof vi.fn> };
  let snapshotsRepository: { findOne: ReturnType<typeof vi.fn>; find: ReturnType<typeof vi.fn> };
  let experimentsService: { armFor: ReturnType<typeof vi.fn> };
  let triadPolicyService: { select: ReturnType<typeof vi.fn> };
  let analyticsService: { record: ReturnType<typeof vi.fn> };
  let profilesRepository: ReturnType<typeof repoMock>;
  let titlesRepository: ReturnType<typeof repoMock>;
  let triadsRepository: ReturnType<typeof repoMock>;
  let statesRepository: ReturnType<typeof repoMock>;
  let recommendationsRepository: ReturnType<typeof repoMock>;
  let outcomesRepository: ReturnType<typeof repoMock>;
  let service: TriadsService;

  const otherUserProfile = { id: 'profile-owned-by-someone-else' };

  beforeEach(() => {
    profilesRepository = repoMock();
    titlesRepository = repoMock();
    triadsRepository = repoMock();
    statesRepository = repoMock();
    recommendationsRepository = repoMock();
    outcomesRepository = repoMock();
    // No matching recommendation by default -- recordRankedOutcomes() is then
    // a no-op, matching every rank() test's behavior before ranked_later
    // existed, unless a test below sets this up itself.
    recommendationsRepository.findOne.mockResolvedValue(null);
    posterService = { attach: vi.fn(async (rows: unknown[]) => rows), forTitles: vi.fn().mockResolvedValue(new Map()) };
    snapshotsRepository = { findOne: vi.fn().mockResolvedValue(null), find: vi.fn() };
    // Control arm by default: every existing test keeps exercising random-v1.
    experimentsService = { armFor: vi.fn().mockResolvedValue('control') };
    triadPolicyService = { select: vi.fn().mockResolvedValue(null) };
    analyticsService = { record: vi.fn().mockResolvedValue(undefined) };
    service = new TriadsService(
      profilesRepository as unknown as Repository<Profile>,
      titlesRepository as unknown as Repository<Title>,
      triadsRepository as unknown as Repository<Triad>,
      statesRepository as unknown as Repository<UserTitleState>,
      recommendationsRepository as unknown as Repository<Recommendation>,
      outcomesRepository as unknown as Repository<Outcome>,
      posterService as unknown as PosterService,
      snapshotsRepository as unknown as Repository<UserModelSnapshot>,
      experimentsService as unknown as ExperimentsService,
      triadPolicyService as unknown as TriadPolicyService,
      analyticsService as unknown as AnalyticsService,
    );
  });

  describe('rank', () => {
    // Ranking is title ids in ranked order, best first -- not indices into
    // titleIds (ADR-15).
    const titleA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const titleB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const titleC = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const validRanking = [titleC, titleA, titleB];
    const activeTriad = {
      id: 'triad-1',
      profileId: 'profile-1',
      status: 'active' as const,
      titleIds: [titleA, titleB, titleC],
    };

    // Call order for a fresh completion: unlocked triad -> ownership -> the
    // transaction (locked re-read of the triad, then one UserTitleState
    // findOne per title inside confirmWatchedFromRanking, ADR-119). `locked`
    // defaults to the same row; `existingState` is what each of the three
    // findOne calls after it resolves to (null -- no prior row -- unless a
    // test cares about an existing one).
    function arrangeRank({
      triad = { ...activeTriad },
      locked = undefined as Record<string, unknown> | undefined,
      existingState = null as Record<string, unknown> | null,
    } = {}) {
      triadsRepository.findOne.mockResolvedValueOnce(triad);
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      triadsRepository.manager.findOne.mockResolvedValueOnce(locked ?? triad).mockResolvedValue(existingState);
      return triad;
    }

    it('rejects a malformed ranking before touching the database', async () => {
      await expect(
        service.rank('user-1', 'triad-1', { ranking: [titleA, titleA, titleB] }), // not distinct
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.rank('user-1', 'triad-1', { ranking: [titleA, titleB] }), // not 3 items
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.rank('user-1', 'triad-1', { ranking: ['not-a-uuid', titleA, titleB] }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(triadsRepository.findOne).not.toHaveBeenCalled();
    });

    it('throws 404 when the triad does not exist', async () => {
      triadsRepository.findOne.mockResolvedValue(null);

      await expect(
        service.rank('user-1', 'missing-triad', { ranking: validRanking }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws 404 (not 403) when the triad belongs to a profile owned by another user', async () => {
      triadsRepository.findOne.mockResolvedValue(activeTriad);
      profilesRepository.findOne.mockResolvedValue(null); // no profile row matches {id, userId}

      await expect(
        service.rank('attacker-user', 'triad-1', { ranking: validRanking }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(profilesRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'profile-1', userId: 'attacker-user' },
      });
      expect(triadsRepository.save).not.toHaveBeenCalled();
    });

    it('rejects submitting a ranking for an already-completed triad', async () => {
      triadsRepository.findOne.mockResolvedValue({ ...activeTriad, status: 'completed' });
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });

      await expect(
        service.rank('user-1', 'triad-1', { ranking: validRanking }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("rejects a well-formed ranking that isn't this triad's own three title ids", async () => {
      triadsRepository.findOne.mockResolvedValue(activeTriad);
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      const foreignTitle = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

      await expect(
        service.rank('user-1', 'triad-1', { ranking: [titleA, titleB, foreignTitle] }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(triadsRepository.save).not.toHaveBeenCalled();
    });

    it('accepts a valid ranking from the owning user, marks the triad completed, and records answeredAt', async () => {
      arrangeRank();

      const result = await service.rank('user-1', 'triad-1', { ranking: validRanking, sessionId: 's1' });

      expect(result.status).toBe('completed');
      expect(result.ranking).toEqual(validRanking);
      expect(result.answeredAt).toBeInstanceOf(Date);
      // The completion itself is written through the locked transaction's
      // manager, not the plain repository (row lock, ADR-119).
      expect(triadsRepository.manager.save).toHaveBeenCalled();
      expect(triadsRepository.save).not.toHaveBeenCalled();
    });

    // ALPHA_PLAN 7.5: the round's duration measured from the row's own two
    // stamps, never from anything a client sends.
    describe('analytics', () => {
      it('records the answered round with the duration between shown and answered', async () => {
        const shownAt = new Date(Date.now() - 4200);
        arrangeRank({ triad: { ...activeTriad, shownAt, modelVersion: 'adaptive-v1' } });

        await service.rank('user-1', 'triad-1', { ranking: validRanking });

        const [profileId, name, properties] = analyticsService.record.mock.calls[0];
        expect([profileId, name]).toEqual(['profile-1', 'triad_answered']);
        expect(properties.durationMs).toBeGreaterThanOrEqual(4200);
        expect(properties.policy).toBe('adaptive-v1');
      });

      // ADR-19: a round never marked shown has an unknown duration, and an
      // unknown is left out rather than reported as 0.
      it('omits the duration entirely when the round was never marked shown', async () => {
        arrangeRank({ triad: { ...activeTriad, shownAt: null } });

        await service.rank('user-1', 'triad-1', { ranking: validRanking });

        expect(analyticsService.record.mock.calls[0][2]).not.toHaveProperty('durationMs');
      });

      // ADR-119: the ranking confirmation is exposure bookkeeping, not the
      // user explicitly saying "I watched this" -- only WatchEventsService's
      // own in_app/import/manual path ever inflates that counter.
      it('never records watch_marked for the exposure confirmation rank() makes', async () => {
        arrangeRank();

        await service.rank('user-1', 'triad-1', { ranking: validRanking });

        expect(analyticsService.record).not.toHaveBeenCalledWith(
          expect.anything(),
          'watch_marked',
          expect.anything(),
          expect.anything(),
        );
      });
    });

    // BP §4.5's "compare prediction to real ranking" arrow (blueprint gap
    // 4, ranked_later): a title in the ranking that was previously
    // recommended gets an outcomes row; one never recommended writes
    // nothing.
    describe('ranked_later outcomes', () => {
      it('writes no outcome for a title that was never recommended (the common case)', async () => {
        arrangeRank();
        recommendationsRepository.findOne.mockResolvedValue(null);

        await service.rank('user-1', 'triad-1', { ranking: validRanking });

        expect(outcomesRepository.save).not.toHaveBeenCalled();
      });

      it('writes an outcome linking the most recent recommendation, with rankPosition matching the final ranking order', async () => {
        arrangeRank();
        recommendationsRepository.findOne.mockImplementation(({ where }: { where: { titleId: string } }) =>
          where.titleId === titleA ? Promise.resolve({ id: 'rec-for-a', profileId: 'profile-1', titleId: titleA }) : Promise.resolve(null),
        );

        // validRanking = [titleC, titleA, titleB] -- titleA is second, index 1.
        await service.rank('user-1', 'triad-1', { ranking: validRanking });

        expect(outcomesRepository.save).toHaveBeenCalledTimes(1);
        expect(outcomesRepository.create).toHaveBeenCalledWith(
          expect.objectContaining({
            recommendationId: 'rec-for-a',
            type: 'ranked_later',
            triadId: 'triad-1',
            rankPosition: 1,
          }),
        );
      });

      it('writes one outcome per recommended title when more than one of the three was recommended', async () => {
        arrangeRank();
        recommendationsRepository.findOne.mockImplementation(({ where }: { where: { titleId: string } }) => {
          if (where.titleId === titleA) return Promise.resolve({ id: 'rec-a', profileId: 'profile-1', titleId: titleA });
          if (where.titleId === titleC) return Promise.resolve({ id: 'rec-c', profileId: 'profile-1', titleId: titleC });
          return Promise.resolve(null);
        });

        await service.rank('user-1', 'triad-1', { ranking: validRanking });

        expect(outcomesRepository.save).toHaveBeenCalledTimes(2);
      });

      it('queries recommendations scoped to this profile, not just the title id', async () => {
        arrangeRank();

        await service.rank('user-1', 'triad-1', { ranking: validRanking });

        expect(recommendationsRepository.findOne).toHaveBeenCalledWith({
          where: { profileId: 'profile-1', titleId: expect.any(String) },
          order: { createdAt: 'DESC' },
        });
      });

      it('does not write ranked_later outcomes on an idempotent replay of an already-completed triad', async () => {
        const idempotencyKey = '99999999-9999-4999-8999-999999999999';
        const alreadySubmitted = { ...activeTriad, status: 'completed' as const, ranking: validRanking, idempotencyKey };
        triadsRepository.findOne.mockResolvedValueOnce(alreadySubmitted);
        profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
        recommendationsRepository.findOne.mockResolvedValue({ id: 'rec-1', profileId: 'profile-1', titleId: titleA });

        await service.rank('user-1', 'triad-1', { ranking: validRanking }, idempotencyKey);

        expect(outcomesRepository.save).not.toHaveBeenCalled();
      });
    });

    describe('idempotency', () => {
      const idempotencyKey = '99999999-9999-4999-8999-999999999999';

      it('rejects a malformed Idempotency-Key', async () => {
        await expect(
          service.rank('user-1', 'triad-1', { ranking: validRanking }, 'not-a-uuid'),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(triadsRepository.findOne).not.toHaveBeenCalled();
      });

      it('returns the prior result instead of erroring on a retry with the same key for the same triad', async () => {
        const alreadySubmitted = { ...activeTriad, status: 'completed' as const, idempotencyKey };
        triadsRepository.findOne.mockResolvedValueOnce(alreadySubmitted); // found by idempotencyKey
        profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });

        const result = await service.rank('user-1', 'triad-1', { ranking: validRanking }, idempotencyKey);

        expect(result).toMatchObject(alreadySubmitted);
        expect(triadsRepository.save).not.toHaveBeenCalled();
      });

      it('rejects reusing the same key for a different triad as a conflict, not a replay', async () => {
        const otherTriad = { ...activeTriad, id: 'triad-other', idempotencyKey };
        triadsRepository.findOne.mockResolvedValueOnce(otherTriad); // found by idempotencyKey, different id

        await expect(
          service.rank('user-1', 'triad-1', { ranking: validRanking }, idempotencyKey),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(triadsRepository.save).not.toHaveBeenCalled();
      });

      it('persists the key on a fresh submission', async () => {
        triadsRepository.findOne.mockResolvedValueOnce(null); // no existing row for this key
        arrangeRank(); // the triad being ranked, plus the locked re-read

        const result = await service.rank('user-1', 'triad-1', { ranking: validRanking }, idempotencyKey);

        expect(result.idempotencyKey).toBe(idempotencyKey);
      });

      it('returns the winning row instead of erroring when it loses a race on the same idempotency key', async () => {
        triadsRepository.findOne
          .mockResolvedValueOnce(null) // no existing row for this key, when first checked
          .mockResolvedValueOnce({ ...activeTriad }) // the triad being ranked (pre-transaction read)
          .mockResolvedValueOnce({ ...activeTriad, status: 'completed', idempotencyKey }); // winner, re-fetched by key
        profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
        triadsRepository.manager.findOne.mockResolvedValueOnce({ ...activeTriad }); // locked re-read, inside the transaction
        triadsRepository.manager.save.mockRejectedValue({ code: '23505' });

        const result = await service.rank('user-1', 'triad-1', { ranking: validRanking }, idempotencyKey);

        expect(result.status).toBe('completed');
        expect(result.idempotencyKey).toBe(idempotencyKey);
      });

      it('does not swallow a save error unrelated to the unique constraint', async () => {
        triadsRepository.findOne
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ ...activeTriad });
        profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
        triadsRepository.manager.findOne.mockResolvedValueOnce({ ...activeTriad });
        triadsRepository.manager.save.mockRejectedValue(new Error('connection lost'));

        await expect(
          service.rank('user-1', 'triad-1', { ranking: validRanking }, idempotencyKey),
        ).rejects.toThrow('connection lost');
      });
    });

    // ADR-119: comparing three films is stronger evidence of exposure than
    // the watch list ever was, so completing a triad confirms all three as
    // watched and records why -- through the same watch_events log
    // WatchEventsService already writes to, not a parallel table. `watched`
    // itself still never becomes a preference signal (that's `ranking`
    // alone); these tests cover only the exposure side.
    describe('confirms watched from ranking (ADR-119)', () => {
      it('creates a watched UserTitleState row for each of the three titles when none exists', async () => {
        arrangeRank({ existingState: null });

        await service.rank('user-1', 'triad-1', { ranking: validRanking });

        // The mock returns the same object it's given, which confirmWatchedFromRanking
        // then mutates in place -- so by the time this assertion runs, each captured
        // call carries the state/watchedAt it ends up with; objectContaining checks
        // only the identity fields this call originally supplied.
        for (const titleId of [titleA, titleB, titleC]) {
          expect(triadsRepository.manager.create).toHaveBeenCalledWith(
            UserTitleState,
            expect.objectContaining({ profileId: 'profile-1', titleId }),
          );
        }
        expect(triadsRepository.manager.save).toHaveBeenCalledWith(
          expect.objectContaining({ state: 'watched', watchedAt: expect.any(Date) }),
        );
      });

      it('leaves an already-watched title exactly as it was -- watchedOn is never overwritten', async () => {
        const existingState = { profileId: 'profile-1', titleId: titleA, state: 'watched', watchedOn: '2026-01-01', watchedAt: new Date('2026-01-01') };
        arrangeRank({ existingState });

        await service.rank('user-1', 'triad-1', { ranking: validRanking });

        expect(existingState).toMatchObject({ state: 'watched', watchedOn: '2026-01-01' });
      });

      // A ranking is definitive evidence (the user just compared the film to
      // two others), so it outranks an exposure list that says otherwise --
      // without fabricating a day nobody supplied (DATE-01).
      it('upgrades a not_watched/watchlist/interested title to watched without inventing a watchedOn', async () => {
        const existingState = { profileId: 'profile-1', titleId: titleB, state: 'not_watched', watchedOn: null, watchedAt: null };
        arrangeRank({ existingState });

        await service.rank('user-1', 'triad-1', { ranking: validRanking });

        expect(existingState).toMatchObject({ state: 'watched', watchedOn: null });
        expect(existingState.watchedAt).toBeInstanceOf(Date);
      });

      it('writes one triad_ranked watch_event per title, with no watchedAt guessed and linked to this triad', async () => {
        arrangeRank();

        await service.rank('user-1', 'triad-1', { ranking: validRanking });

        for (const titleId of [titleA, titleB, titleC]) {
          expect(triadsRepository.manager.create).toHaveBeenCalledWith(WatchEvent, {
            profileId: 'profile-1',
            titleId,
            watchedAt: null,
            source: 'triad_ranked',
            triadId: 'triad-1',
          });
        }
      });

      it('never re-confirms watched on an idempotent replay -- no transaction runs at all', async () => {
        const idempotencyKey = '99999999-9999-4999-8999-999999999999';
        const alreadySubmitted = { ...activeTriad, status: 'completed' as const, ranking: validRanking, idempotencyKey };
        triadsRepository.findOne.mockResolvedValueOnce(alreadySubmitted);
        profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });

        await service.rank('user-1', 'triad-1', { ranking: validRanking }, idempotencyKey);

        expect(triadsRepository.manager.transaction).not.toHaveBeenCalled();
      });

      it('rejects when the locked re-read finds the triad already completed by a concurrent submission', async () => {
        arrangeRank({ locked: { ...activeTriad, status: 'completed' } });

        await expect(service.rank('user-1', 'triad-1', { ranking: validRanking })).rejects.toBeInstanceOf(
          BadRequestException,
        );
        expect(triadsRepository.manager.save).not.toHaveBeenCalled();
      });
    });
  });

  describe('getCurrent', () => {
    it('throws 404 when the profile does not belong to the requesting user', async () => {
      profilesRepository.findOne.mockResolvedValue(null);

      await expect(service.getCurrent('attacker-user', otherUserProfile.id)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('returns the existing active triad instead of creating a new one', async () => {
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      const existing = { id: 'triad-active', profileId: 'profile-1', status: 'active' };
      triadsRepository.findOne.mockResolvedValue(existing);

      const result = await service.getCurrent('user-1', 'profile-1');

      expect(result).toMatchObject(existing);
      expect(triadsRepository.save).not.toHaveBeenCalled();
    });

    it('returns the three titles inline, in displayOrder, with only the public columns selected', async () => {
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      triadsRepository.findOne.mockResolvedValue({
        id: 'triad-active',
        profileId: 'profile-1',
        status: 'active',
        titleIds: ['t1', 't2', 't3'],
        displayOrder: ['t3', 't1', 't2'],
      });
      titlesRepository.find.mockResolvedValue([
        { id: 't1', titleEn: 'One' },
        { id: 't2', titleEn: 'Two' },
        { id: 't3', titleEn: 'Three' },
      ]);

      const result = await service.getCurrent('user-1', 'profile-1');

      // One round trip for the screen instead of one call per title.
      expect(result.items.map((item) => item.id)).toEqual(['t3', 't1', 't2']);
      const [findOptions] = titlesRepository.find.mock.calls[0];
      // Never the fingerprint or external ids (the catalog's public columns).
      expect(findOptions.select).not.toHaveProperty('fingerprint');
      expect(findOptions.select).not.toHaveProperty('externalIds');
      expect(findOptions.select).toMatchObject({ id: true, titleAr: true, titleEn: true, releaseYear: true });
    });

    it('requires at least three watched titles before a triad can be created', async () => {
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      triadsRepository.findOne
        .mockResolvedValueOnce(null) // no active triad
        .mockResolvedValueOnce(null); // no previous completed triad
      statesRepository.find.mockResolvedValue([{ titleId: 't1' }, { titleId: 't2' }]); // only 2 watched

      expect(await service.getCurrent('user-1', 'profile-1')).toMatchObject({
        state: 'need_more_watched',
        needed: 1,
        message: 'Mark at least three films as watched before starting a ranking round',
      });
    });

    // H1: TriadsService used to exclude every title that had ever appeared in
    // any completed triad -- with W watched titles a profile could complete
    // at most floor(W/3) triads, ever (5 max on the 15-title seed catalog),
    // and a user with exactly 3 watched titles who ranked them got "mark at
    // least three" back even though they just had. Repetition is a soft
    // penalty in the blueprint's selection score (BP §8.2 "-λr·Repeat"), not
    // a permanent ban -- BP §8.1 even names deliberate re-testing of a past
    // comparison ("verification/refutation in an independent context") as
    // one of the six triad functions.
    describe('H1: title reuse across triads', () => {
      it("excludes only the most recently completed triad's titles, not every title ever ranked", async () => {
        profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
        triadsRepository.findOne
          .mockResolvedValueOnce(null) // no active triad
          .mockResolvedValueOnce({ titleIds: ['t4', 't5', 't6'] }); // most recently completed triad
        statesRepository.find.mockResolvedValue(
          ['t1', 't2', 't3', 't4', 't5', 't6'].map((titleId) => ({ titleId })),
        );

        const result = await service.getCurrent('user-1', 'profile-1');

        // t1-t3 (from an older, already-completed triad) must stay eligible --
        // only t4-t6 (the immediately previous triad) are excluded, leaving
        // exactly one possible set.
        expect(result).toMatchObject({ state: 'ready' });
        expect([...(result as { titleIds: string[] }).titleIds].sort()).toEqual(['t1', 't2', 't3']);
      });

      it('applies no exclusion filter when there is no previous completed triad', async () => {
        profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
        triadsRepository.findOne
          .mockResolvedValueOnce(null) // no active triad
          .mockResolvedValueOnce(null); // no previous completed triad
        statesRepository.find.mockResolvedValue([{ titleId: 't1' }, { titleId: 't2' }, { titleId: 't3' }]);

        const result = await service.getCurrent('user-1', 'profile-1');

        expect(result).toMatchObject({ state: 'ready' });
        expect([...(result as { titleIds: string[] }).titleIds].sort()).toEqual(['t1', 't2', 't3']);
      });

      // ADR-108, revising ADR-34's H1: resting the last round's titles is a
      // preference. With exactly three watched films the only thing resting
      // them can produce is a wall, so the round is drawn anyway -- and
      // labelled `verify`, so it is worth nothing toward activation.
      it('draws a verify round, not a wall, when the 3 watched titles were all just used', async () => {
        profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
        triadsRepository.findOne
          .mockResolvedValueOnce(null) // no active triad
          .mockResolvedValueOnce({ titleIds: ['t1', 't2', 't3'] }); // just-completed triad used all 3 watched titles
        statesRepository.find.mockResolvedValue([{ titleId: 't1' }, { titleId: 't2' }, { titleId: 't3' }]);
        triadsRepository.find.mockResolvedValue([{ setHash: triadSetHash(['t1', 't2', 't3']), titleIds: ['t1', 't2', 't3'] }]);

        const result = await service.getCurrent('user-1', 'profile-1');

        expect(result).toMatchObject({ state: 'ready', purpose: 'verify' });
        const [created] = triadsRepository.create.mock.calls[0];
        expect(created).toMatchObject({ purpose: 'verify', countsTowardActivation: false });
      });

      // The other half of the same rule: `needed` is a real remainder, so a
      // profile with one watched film is asked for two, never for a constant.
      it('reports the real remainder when fewer than three films are watched', async () => {
        profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
        triadsRepository.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
        statesRepository.find.mockResolvedValue([{ titleId: 't1' }]);

        expect(await service.getCurrent('user-1', 'profile-1')).toMatchObject({ state: 'need_more_watched', needed: 2 });
      });
    });

    // ADR-99 (remediation brief P0-04): the live round of 2026-09-05 got
    // round 2's exact films back in round 4, saved with the round-2 ranking
    // still shown, and it counted as a fresh piece of evidence.
    describe('ADR-99: set reuse and the verify label', () => {
      it('labels a fresh set "learn" and counts it toward activation', async () => {
        profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
        triadsRepository.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(null); // no active, no previous
        triadsRepository.find.mockResolvedValue([]); // no completed sets yet
        statesRepository.find.mockResolvedValue([{ titleId: 't1' }, { titleId: 't2' }, { titleId: 't3' }]);

        await service.getCurrent('user-1', 'profile-1');

        const [created] = triadsRepository.create.mock.calls[0];
        expect(created).toMatchObject({ purpose: 'learn', countsTowardActivation: true });
        expect(created.setHash).toEqual(expect.any(String));
      });

      it('draws the one remaining set instead of repeating an already-completed one', async () => {
        profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
        triadsRepository.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
        // Four watched titles -> four possible sets; one of them (t1,t2,t3) is
        // already completed, so the only set left is (t1,t2,t4)/(t1,t3,t4)/etc.
        statesRepository.find.mockResolvedValue(['t1', 't2', 't3', 't4'].map((titleId) => ({ titleId })));
        const completedHash = triadSetHash(['t1', 't2', 't3']);
        triadsRepository.find.mockResolvedValue([{ setHash: completedHash, titleIds: ['t1', 't2', 't3'] }]);

        const result = await service.getCurrent('user-1', 'profile-1');

        expect(result).toMatchObject({ purpose: 'learn' });
        expect([...(result as { titleIds: string[] }).titleIds].sort()).not.toEqual(['t1', 't2', 't3']);
      });

      it('falls back to a labeled "verify" round, worth nothing, when every set is already completed', async () => {
        profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
        triadsRepository.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
        statesRepository.find.mockResolvedValue([{ titleId: 't1' }, { titleId: 't2' }, { titleId: 't3' }]);
        // The only possible set out of exactly 3 watched titles is already done.
        triadsRepository.find.mockResolvedValue([{ setHash: triadSetHash(['t1', 't2', 't3']), titleIds: [] }]);

        const result = await service.getCurrent('user-1', 'profile-1');

        expect(result).toMatchObject({ purpose: 'verify' });
        const [created] = triadsRepository.create.mock.calls[0];
        expect(created).toMatchObject({ purpose: 'verify', countsTowardActivation: false });
      });
    });

    it('records shownAt when a new triad is created', async () => {
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      triadsRepository.findOne
        .mockResolvedValueOnce(null) // no active triad
        .mockResolvedValueOnce(null); // no previous completed triad
      statesRepository.find.mockResolvedValue([{ titleId: 't1' }, { titleId: 't2' }, { titleId: 't3' }]);

      const result = await service.getCurrent('user-1', 'profile-1');

      expect(result.shownAt).toBeInstanceOf(Date);
    });

    // ADR-122: armFor() is stubbed to 'control' by default (see beforeEach);
    // the row must say so explicitly rather than leaving experimentId/arm null.
    it('records which experiment surface and arm produced the triad', async () => {
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      triadsRepository.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      statesRepository.find.mockResolvedValue([{ titleId: 't1' }, { titleId: 't2' }, { titleId: 't3' }]);

      await service.getCurrent('user-1', 'profile-1');

      const [created] = triadsRepository.create.mock.calls[0];
      expect(created).toMatchObject({ experimentId: TRIAD_POLICY_EXPERIMENT, arm: 'control' });
    });

    it('draws only from watched titles that are still triad-eligible (ADR-17)', async () => {
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      triadsRepository.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      statesRepository.find.mockResolvedValue([{ titleId: 't1' }, { titleId: 't2' }, { titleId: 't3' }]);

      await service.getCurrent('user-1', 'profile-1');

      // A "don't remember" title stays watched but must never be asked about
      // again -- the pool query has to say so, not just the write side.
      expect(statesRepository.find).toHaveBeenCalledWith({
        where: { profileId: 'profile-1', state: 'watched', triadEligible: true },
        select: { titleId: true },
      });
    });

    it('tells the client how many more watched titles it needs, as structured fields', async () => {
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      triadsRepository.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      statesRepository.find.mockResolvedValue([{ titleId: 't1' }]); // only 1 watched

      // A designed state, not an error (board B→A): 200 with a
      // discriminator, so the UI can say "mark two more" and the console
      // stays clean.
      expect(await service.getCurrent('user-1', 'profile-1')).toMatchObject({
        state: 'need_more_watched',
        needed: 2,
      });
    });

    it('returns the winning row instead of a duplicate when it loses a race to create the active triad', async () => {
      // Two concurrent getCurrent() calls for the same profile can both see
      // "no active triad" and both attempt to insert one; the DB's partial
      // unique index (migration AddOneActiveTriadPerProfileConstraint) lets
      // only one succeed, and the loser must return that row, not error.
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      const winner = { id: 'triad-winner', profileId: 'profile-1', status: 'active' as const };
      triadsRepository.findOne
        .mockResolvedValueOnce(null) // no active triad yet, when we first check
        .mockResolvedValueOnce(null) // no previous completed triad
        .mockResolvedValueOnce(winner); // re-fetched after losing the insert race
      statesRepository.find.mockResolvedValue([{ titleId: 't1' }, { titleId: 't2' }, { titleId: 't3' }]);
      triadsRepository.save.mockRejectedValue({ code: '23505' });

      const result = await service.getCurrent('user-1', 'profile-1');

      expect(result).toMatchObject(winner);
    });

    it('does not swallow a save error unrelated to the unique constraint', async () => {
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      triadsRepository.findOne
        .mockResolvedValueOnce(null) // no active triad
        .mockResolvedValueOnce(null); // no previous completed triad
      statesRepository.find.mockResolvedValue([{ titleId: 't1' }, { titleId: 't2' }, { titleId: 't3' }]);
      triadsRepository.save.mockRejectedValue(new Error('connection lost'));

      await expect(service.getCurrent('user-1', 'profile-1')).rejects.toThrow('connection lost');
    });
  });

  describe('findCompleted', () => {
    it('throws 404 when the profile does not belong to the requesting user', async () => {
      profilesRepository.findOne.mockResolvedValue(null);

      await expect(service.findCompleted('attacker-user', otherUserProfile.id)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(triadsRepository.find).not.toHaveBeenCalled();
    });

    it('scopes the query to the owning profile', async () => {
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      triadsRepository.find.mockResolvedValue([{ id: 'triad-1' }]);

      const result = await service.findCompleted('user-1', 'profile-1');

      expect(triadsRepository.find).toHaveBeenCalledWith({
        where: { profileId: 'profile-1', status: 'completed' },
        order: { createdAt: 'DESC' },
      });
      expect(result).toEqual([{ id: 'triad-1' }]);
    });
  });

  // The two neutral replacement controls (blueprint §4.3, ADR-17). Neither
  // reason is a preference: these tests pin the exposure bookkeeping each
  // one implies, the append-only event row, and the "nothing left to swap
  // in" path -- not any effect on ranking data, because there is none.
  describe('replace', () => {
    const titleA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const titleB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const titleC = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const spare = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const activeTriad = () => ({
      id: 'triad-1',
      profileId: 'profile-1',
      status: 'active' as const,
      titleIds: [titleA, titleB, titleC],
      displayOrder: [titleC, titleA, titleB],
    });

    // Call order inside replace(): triad -> ownership -> the transaction
    // (locked re-read of the triad -> prior replacement count -> previous
    // completed triad -> eligible watched states -> state row, event row,
    // triad). `locked` is what the row-locked re-read returns: the same row
    // unless a test simulates a concurrent write landing first (H3).
    function arrange({
      triad = activeTriad(),
      locked = undefined as Record<string, unknown> | undefined,
      eligible = [titleA, titleB, titleC, spare],
      previousTriad = null as { titleIds: string[] } | null,
      priorReplacements = 0,
      stateRow = { profileId: 'profile-1', titleId: titleB, state: 'watched', watchedAt: new Date(), triadEligible: true } as
        | Record<string, unknown>
        | null,
    } = {}) {
      triadsRepository.findOne.mockResolvedValueOnce(triad).mockResolvedValueOnce(previousTriad);
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      triadsRepository.manager.count.mockResolvedValue(priorReplacements);
      statesRepository.find.mockResolvedValue(eligible.map((titleId) => ({ titleId })));
      triadsRepository.manager.findOne.mockResolvedValueOnce(locked ?? triad).mockResolvedValue(stateRow);
      return triad;
    }

    it('throws 404 when the triad does not exist', async () => {
      triadsRepository.findOne.mockResolvedValue(null);

      await expect(
        service.replace('user-1', 'missing', { titleId: titleB, reason: 'not_watched' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("throws 404 (not 403) for another user's triad and writes nothing", async () => {
      triadsRepository.findOne.mockResolvedValue(activeTriad());
      profilesRepository.findOne.mockResolvedValue(null);

      await expect(
        service.replace('attacker-user', 'triad-1', { titleId: titleB, reason: 'not_watched' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(triadsRepository.manager.transaction).not.toHaveBeenCalled();
    });

    it('rejects a triad that is no longer active', async () => {
      arrange({ triad: { ...activeTriad(), status: 'completed' as never } });

      await expect(
        service.replace('user-1', 'triad-1', { titleId: titleB, reason: 'not_watched' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(triadsRepository.manager.transaction).not.toHaveBeenCalled();
    });

    it("rejects a title that is not one of the triad's own three", async () => {
      arrange();

      await expect(
        service.replace('user-1', 'triad-1', { titleId: spare, reason: 'not_watched' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(triadsRepository.manager.transaction).not.toHaveBeenCalled();
    });

    it('not_watched: swaps the same slot, redraws displayOrder, clears exposure, and logs the event', async () => {
      const stateRow = { profileId: 'profile-1', titleId: titleB, state: 'watched', watchedAt: new Date(), triadEligible: true };
      arrange({ stateRow });

      const result = await service.replace('user-1', 'triad-1', { titleId: titleB, reason: 'not_watched' });

      expect(result.status).toBe('active');
      expect(result.titleIds).toEqual([titleA, spare, titleC]);
      expect([...(result.displayOrder as string[])].sort()).toEqual([titleA, titleC, spare].sort());
      // Exposure unknown, not a negative signal (BP §2.4 #3): the title
      // leaves the watched set and its watch date goes with it.
      expect(stateRow).toMatchObject({ state: 'not_watched', watchedAt: null, triadEligible: true });
      expect(triadsRepository.manager.create).toHaveBeenCalledWith(TriadReplacement, {
        triadId: 'triad-1',
        replacedTitleId: titleB,
        replacementTitleId: spare,
        reason: 'not_watched',
      });
      // state row, event row, triad -- all inside the one transaction
      expect(triadsRepository.manager.transaction).toHaveBeenCalledTimes(1);
      expect(triadsRepository.manager.save).toHaveBeenCalledTimes(3);
      expect(triadsRepository.save).not.toHaveBeenCalled();
    });

    it('not_remembered: keeps the watch, clears triadEligible, and still swaps the item', async () => {
      const stateRow = { profileId: 'profile-1', titleId: titleB, state: 'watched', watchedAt: new Date(), triadEligible: true };
      arrange({ stateRow });

      const result = await service.replace('user-1', 'triad-1', { titleId: titleB, reason: 'not_remembered' });

      expect(result.titleIds).toEqual([titleA, spare, titleC]);
      // Still watched (not recommendable), never asked about in a triad again.
      expect(stateRow).toMatchObject({ state: 'watched', triadEligible: false });
      expect(stateRow.watchedAt).toBeInstanceOf(Date);
    });

    it('never picks the replaced title, a title already in the triad, or one from the previous completed triad', async () => {
      const fresh = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
      arrange({ eligible: [titleA, titleB, titleC, spare, fresh], previousTriad: { titleIds: [spare] } });

      const result = await service.replace('user-1', 'triad-1', { titleId: titleB, reason: 'not_watched' });

      // spare is excluded by the same one-triad lookback getCurrent() uses
      // (ADR-34), so `fresh` is the only legal pick.
      expect(result.titleIds).toEqual([titleA, fresh, titleC]);
    });

    it('marks the triad skipped, with a null replacement in the event, when nothing eligible is left', async () => {
      arrange({ eligible: [titleA, titleB, titleC] });

      const result = await service.replace('user-1', 'triad-1', { titleId: titleB, reason: 'not_watched' });

      expect(result.status).toBe('skipped');
      expect(result.titleIds).toEqual([titleA, titleB, titleC]);
      expect(triadsRepository.manager.create).toHaveBeenCalledWith(
        TriadReplacement,
        expect.objectContaining({ replacedTitleId: titleB, replacementTitleId: null }),
      );
    });

    it('marks the triad skipped once the per-triad replacement limit is exceeded, without drawing', async () => {
      arrange({ priorReplacements: 3 });

      const result = await service.replace('user-1', 'triad-1', { titleId: titleB, reason: 'not_remembered' });

      expect(result.status).toBe('skipped');
      expect(statesRepository.find).not.toHaveBeenCalled();
      // The user's statement is still recorded even though nothing was swapped.
      expect(triadsRepository.manager.create).toHaveBeenCalledWith(
        TriadReplacement,
        expect.objectContaining({ reason: 'not_remembered', replacementTitleId: null }),
      );
    });

    // H3: every decision that shapes the swap is made on a row-locked
    // re-read inside the transaction, so two concurrent calls for the same
    // triad serialize instead of both passing the checks on one stale read.
    it('re-reads the triad under a row lock inside the transaction and counts prior replacements there', async () => {
      arrange();

      await service.replace('user-1', 'triad-1', { titleId: titleB, reason: 'not_watched' });

      expect(triadsRepository.manager.findOne).toHaveBeenNthCalledWith(1, Triad, {
        where: { id: 'triad-1' },
        lock: { mode: 'pessimistic_write' },
      });
      expect(triadsRepository.manager.count).toHaveBeenCalledWith(TriadReplacement, { where: { triadId: 'triad-1' } });
    });

    it("returns the winner's triad without writing when a concurrent call already swapped the same title", async () => {
      const winner = { ...activeTriad(), titleIds: [titleA, spare, titleC], displayOrder: [spare, titleC, titleA] };
      arrange({ locked: winner });

      const result = await service.replace('user-1', 'triad-1', { titleId: titleB, reason: 'not_watched' });

      expect(result.titleIds).toEqual([titleA, spare, titleC]);
      expect(triadsRepository.manager.save).not.toHaveBeenCalled();
      expect(triadsRepository.manager.create).not.toHaveBeenCalled();
      expect(statesRepository.find).not.toHaveBeenCalled();
    });

    it('rejects, without writing, when a concurrent call closed the triad before the lock was taken', async () => {
      arrange({ locked: { ...activeTriad(), status: 'skipped' } });

      await expect(
        service.replace('user-1', 'triad-1', { titleId: titleB, reason: 'not_watched' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(triadsRepository.manager.save).not.toHaveBeenCalled();
      expect(triadsRepository.manager.create).not.toHaveBeenCalled();
    });

    it("decides the replacement limit from the locked row's count, not a pre-lock read", async () => {
      arrange({ priorReplacements: 3 });

      const result = await service.replace('user-1', 'triad-1', { titleId: titleB, reason: 'not_watched' });

      expect(result.status).toBe('skipped');
      expect(triadsRepository.manager.count).toHaveBeenCalledTimes(1);
    });

    it('creates the state row when none exists for the title yet', async () => {
      arrange({ stateRow: null });

      await service.replace('user-1', 'triad-1', { titleId: titleB, reason: 'not_watched' });

      // The mock's create() hands back the same object the service then
      // mutates, so only the identifying fields are stable to assert on here;
      // the reason's effect is checked on what was saved.
      expect(triadsRepository.manager.create).toHaveBeenCalledWith(
        UserTitleState,
        expect.objectContaining({ profileId: 'profile-1', titleId: titleB }),
      );
      expect(triadsRepository.manager.save).toHaveBeenCalledWith(
        expect.objectContaining({ profileId: 'profile-1', titleId: titleB, state: 'not_watched', watchedAt: null }),
      );
    });
  });
});
