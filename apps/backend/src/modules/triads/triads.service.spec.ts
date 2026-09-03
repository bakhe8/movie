import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { Profile } from '../../entities/profile.entity';
import { Title } from '../../entities/title.entity';
import { Triad } from '../../entities/triad.entity';
import { TriadReplacement } from '../../entities/triad-replacement.entity';
import { UserTitleState } from '../../entities/user-title-state.entity';
import { TriadsService } from './triads.service';

function repoMock() {
  // `manager.transaction(run)` hands `run` the same manager mock, so a test
  // can assert every write that happened inside the transaction.
  const manager = {
    findOne: vi.fn(),
    save: vi.fn(async (entity: unknown) => entity),
    create: vi.fn((_target: unknown, data: unknown) => data),
    transaction: vi.fn(async (run: (manager: unknown) => Promise<unknown>) => run(manager)),
  };
  return {
    findOne: vi.fn(),
    find: vi.fn(),
    count: vi.fn(),
    save: vi.fn(async (entity: unknown) => entity),
    create: vi.fn((data: unknown) => data),
    createQueryBuilder: vi.fn(),
    manager,
  };
}

function titlesQueryBuilderMock(titles: Title[], poolSize: number) {
  return {
    orderBy: vi.fn().mockReturnThis(),
    take: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    getManyAndCount: vi.fn().mockResolvedValue([titles, poolSize]),
  };
}

describe('TriadsService', () => {
  let profilesRepository: ReturnType<typeof repoMock>;
  let titlesRepository: ReturnType<typeof repoMock>;
  let triadsRepository: ReturnType<typeof repoMock>;
  let statesRepository: ReturnType<typeof repoMock>;
  let replacementsRepository: ReturnType<typeof repoMock>;
  let service: TriadsService;

  const otherUserProfile = { id: 'profile-owned-by-someone-else' };

  beforeEach(() => {
    profilesRepository = repoMock();
    titlesRepository = repoMock();
    triadsRepository = repoMock();
    statesRepository = repoMock();
    replacementsRepository = repoMock();
    service = new TriadsService(
      profilesRepository as unknown as Repository<Profile>,
      titlesRepository as unknown as Repository<Title>,
      triadsRepository as unknown as Repository<Triad>,
      statesRepository as unknown as Repository<UserTitleState>,
      replacementsRepository as unknown as Repository<TriadReplacement>,
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
      triadsRepository.findOne.mockResolvedValue({ ...activeTriad });
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });

      const result = await service.rank('user-1', 'triad-1', { ranking: validRanking, sessionId: 's1' });

      expect(result.status).toBe('completed');
      expect(result.ranking).toEqual(validRanking);
      expect(result.answeredAt).toBeInstanceOf(Date);
      expect(triadsRepository.save).toHaveBeenCalled();
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

        expect(result).toBe(alreadySubmitted);
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
        triadsRepository.findOne
          .mockResolvedValueOnce(null) // no existing row for this key
          .mockResolvedValueOnce({ ...activeTriad }); // the triad being ranked
        profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });

        const result = await service.rank('user-1', 'triad-1', { ranking: validRanking }, idempotencyKey);

        expect(result.idempotencyKey).toBe(idempotencyKey);
      });

      it('returns the winning row instead of erroring when it loses a race on the same idempotency key', async () => {
        triadsRepository.findOne
          .mockResolvedValueOnce(null) // no existing row for this key, when first checked
          .mockResolvedValueOnce({ ...activeTriad }) // the triad being ranked
          .mockResolvedValueOnce({ ...activeTriad, status: 'completed', idempotencyKey }); // winner, re-fetched by key
        profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
        triadsRepository.save.mockRejectedValue({ code: '23505' });

        const result = await service.rank('user-1', 'triad-1', { ranking: validRanking }, idempotencyKey);

        expect(result.status).toBe('completed');
        expect(result.idempotencyKey).toBe(idempotencyKey);
      });

      it('does not swallow a save error unrelated to the unique constraint', async () => {
        triadsRepository.findOne
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ ...activeTriad });
        profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
        triadsRepository.save.mockRejectedValue(new Error('connection lost'));

        await expect(
          service.rank('user-1', 'triad-1', { ranking: validRanking }, idempotencyKey),
        ).rejects.toThrow('connection lost');
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

      expect(result).toBe(existing);
      expect(triadsRepository.save).not.toHaveBeenCalled();
    });

    it('requires at least three watched titles before a triad can be created', async () => {
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      triadsRepository.findOne
        .mockResolvedValueOnce(null) // no active triad
        .mockResolvedValueOnce(null); // no previous completed triad
      statesRepository.find.mockResolvedValue([{ titleId: 't1' }, { titleId: 't2' }]); // only 2 watched

      await expect(service.getCurrent('user-1', 'profile-1')).rejects.toThrow(
        'Mark at least three films as watched before starting a ranking round',
      );
      expect(titlesRepository.createQueryBuilder).not.toHaveBeenCalled();
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
        const builder = titlesQueryBuilderMock([{ id: 't1' }, { id: 't2' }, { id: 't3' }] as Title[], 3);
        titlesRepository.createQueryBuilder.mockReturnValue(builder);

        await service.getCurrent('user-1', 'profile-1');

        // t1-t3 (from an older, already-completed triad) must stay eligible --
        // only t4-t6 (the immediately previous triad) are excluded.
        expect(builder.andWhere).toHaveBeenCalledWith('title.id NOT IN (:...recentlyUsedTitleIds)', {
          recentlyUsedTitleIds: ['t4', 't5', 't6'],
        });
      });

      it('applies no exclusion filter when there is no previous completed triad', async () => {
        profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
        triadsRepository.findOne
          .mockResolvedValueOnce(null) // no active triad
          .mockResolvedValueOnce(null); // no previous completed triad
        statesRepository.find.mockResolvedValue([{ titleId: 't1' }, { titleId: 't2' }, { titleId: 't3' }]);
        const builder = titlesQueryBuilderMock([{ id: 't1' }, { id: 't2' }, { id: 't3' }] as Title[], 3);
        titlesRepository.createQueryBuilder.mockReturnValue(builder);

        await service.getCurrent('user-1', 'profile-1');

        expect(builder.andWhere).not.toHaveBeenCalled();
      });

      it('reports "mark another film", not "mark three", when 3+ watched titles exist but all were just used', async () => {
        profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
        triadsRepository.findOne
          .mockResolvedValueOnce(null) // no active triad
          .mockResolvedValueOnce({ titleIds: ['t1', 't2', 't3'] }); // just-completed triad used all 3 watched titles
        statesRepository.find.mockResolvedValue([{ titleId: 't1' }, { titleId: 't2' }, { titleId: 't3' }]);
        titlesRepository.createQueryBuilder.mockReturnValue(titlesQueryBuilderMock([], 0));

        await expect(service.getCurrent('user-1', 'profile-1')).rejects.toThrow(
          'Mark another film as watched to start a new ranking round',
        );
      });
    });

    it('records shownAt when a new triad is created', async () => {
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      triadsRepository.findOne
        .mockResolvedValueOnce(null) // no active triad
        .mockResolvedValueOnce(null); // no previous completed triad
      statesRepository.find.mockResolvedValue([{ titleId: 't1' }, { titleId: 't2' }, { titleId: 't3' }]);
      titlesRepository.createQueryBuilder.mockReturnValue(
        titlesQueryBuilderMock([{ id: 't1' }, { id: 't2' }, { id: 't3' }] as Title[], 3),
      );

      const result = await service.getCurrent('user-1', 'profile-1');

      expect(result.shownAt).toBeInstanceOf(Date);
    });

    it('draws only from watched titles that are still triad-eligible (ADR-17)', async () => {
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      triadsRepository.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      statesRepository.find.mockResolvedValue([{ titleId: 't1' }, { titleId: 't2' }, { titleId: 't3' }]);
      titlesRepository.createQueryBuilder.mockReturnValue(
        titlesQueryBuilderMock([{ id: 't1' }, { id: 't2' }, { id: 't3' }] as Title[], 3),
      );

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

      const error = await service.getCurrent('user-1', 'profile-1').catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(BadRequestException);
      // Target contract shape (API.md §2.2) alongside Nest's default fields,
      // so the UI can say "mark two more" instead of parsing English prose.
      expect((error as BadRequestException).getResponse()).toMatchObject({
        statusCode: 400,
        reason: 'need_more_watched',
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
      titlesRepository.createQueryBuilder.mockReturnValue(
        titlesQueryBuilderMock([{ id: 't1' }, { id: 't2' }, { id: 't3' }] as Title[], 3),
      );
      triadsRepository.save.mockRejectedValue({ code: '23505' });

      const result = await service.getCurrent('user-1', 'profile-1');

      expect(result).toBe(winner);
    });

    it('does not swallow a save error unrelated to the unique constraint', async () => {
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      triadsRepository.findOne
        .mockResolvedValueOnce(null) // no active triad
        .mockResolvedValueOnce(null); // no previous completed triad
      statesRepository.find.mockResolvedValue([{ titleId: 't1' }, { titleId: 't2' }, { titleId: 't3' }]);
      titlesRepository.createQueryBuilder.mockReturnValue(
        titlesQueryBuilderMock([{ id: 't1' }, { id: 't2' }, { id: 't3' }] as Title[], 3),
      );
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

    // Call order inside replace(): triad -> ownership -> prior replacement
    // count -> previous completed triad -> eligible watched states -> the
    // transaction (state row, event row, triad).
    function arrange({
      triad = activeTriad(),
      eligible = [titleA, titleB, titleC, spare],
      previousTriad = null as { titleIds: string[] } | null,
      priorReplacements = 0,
      stateRow = { profileId: 'profile-1', titleId: titleB, state: 'watched', watchedAt: new Date(), triadEligible: true } as
        | Record<string, unknown>
        | null,
    } = {}) {
      triadsRepository.findOne.mockResolvedValueOnce(triad).mockResolvedValueOnce(previousTriad);
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      replacementsRepository.count.mockResolvedValue(priorReplacements);
      statesRepository.find.mockResolvedValue(eligible.map((titleId) => ({ titleId })));
      triadsRepository.manager.findOne.mockResolvedValue(stateRow);
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
