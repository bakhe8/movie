import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { isUUID } from 'class-validator';
import { EntityManager, In, Repository } from 'typeorm';
import { Profile } from '../../entities/profile.entity';
import { Title } from '../../entities/title.entity';
import { Triad } from '../../entities/triad.entity';
import { ReplacementReason, TriadReplacement } from '../../entities/triad-replacement.entity';
import { UserTitleState } from '../../entities/user-title-state.entity';
import { RankTriadDto } from './dto/rank-triad.dto';
import { ReplaceTriadItemDto } from './dto/replace-triad-item.dto';

// Bumped whenever the triad-selection policy changes; see
// docs/movie_taste_platform_blueprint_ar.md section 13.2 (triad_events).
const TRIAD_POLICY_VERSION = 'random-v1';

// Policy parameter (ADR-17): a triad that would need more than this many
// replacements is abandoned (`skipped`) rather than patched indefinitely.
// ADR-17 leaves the value to be "set before the Phase 0 test"; this is the
// interim number, and the replacement rate it produces is itself a Phase 0
// metric (BP §17.1).
const MAX_REPLACEMENTS_PER_TRIAD = 3;

interface CandidateSelection {
  titles: Title[];
  poolSize: number;
}

// What the triad screen needs about each title -- never the fingerprint or
// external ids (the catalog's public columns, see TitlesService).
export type TriadItem = Pick<
  Title,
  'id' | 'internalId' | 'titleEn' | 'titleAr' | 'description' | 'releaseYear' | 'genres' | 'createdAt' | 'updatedAt'
>;

// A triad as the API returns it: the row plus its three titles in
// displayOrder, so the client renders in one round trip instead of one
// call per title (target contract API.md §2.3 `items`).
export type TriadWithItems = Triad & { items: TriadItem[] };

@Injectable()
export class TriadsService {
  constructor(
    @InjectRepository(Profile)
    private readonly profilesRepository: Repository<Profile>,
    @InjectRepository(Title)
    private readonly titlesRepository: Repository<Title>,
    @InjectRepository(Triad)
    private readonly triadsRepository: Repository<Triad>,
    @InjectRepository(UserTitleState)
    private readonly statesRepository: Repository<UserTitleState>,
    @InjectRepository(TriadReplacement)
    private readonly replacementsRepository: Repository<TriadReplacement>,
  ) {}

  async getCurrent(userId: string, profileId: string): Promise<TriadWithItems> {
    await this.assertProfileOwnership(userId, profileId);

    const activeTriad = await this.triadsRepository.findOne({
      where: { profileId, status: 'active' },
      order: { createdAt: 'ASC' },
    });
    if (activeTriad) {
      return this.withItems(activeTriad);
    }

    // Only the most recently completed triad's titles are excluded, not
    // every title this profile has ever ranked (H1, ADR-34): repetition is
    // a soft penalty in the blueprint's selection score (BP §8.2 "-λr·Repeat"),
    // never a permanent ban (BP §8.1 even names "verification/refutation in
    // an independent context" as a deliberate re-test of a past comparison).
    // random-v1 has no scoring function to apply a soft penalty through, so
    // "not the immediately previous triad" is its policy-appropriate stand-in.
    const previousTriad = await this.triadsRepository.findOne({
      where: { profileId, status: 'completed' },
      order: { createdAt: 'DESC' },
      select: { titleIds: true },
    });
    const recentlyUsedTitleIds = previousTriad?.titleIds ?? [];
    const watchedTitleIds = await this.eligibleWatchedTitleIds(profileId);
    const { titles, poolSize } = await this.selectRandomTitles(watchedTitleIds, recentlyUsedTitleIds);

    if (titles.length < 3) {
      // Two genuinely different situations (H1): fewer than 3 watched titles
      // exist at all, vs. there are 3+ but all remaining ones were just used
      // in the previous triad -- the fix is "mark one more film", not "mark
      // three", and telling a user who already has three to do that again is
      // the exact false message this replaces.
      const needed = watchedTitleIds.length < 3 ? 3 - watchedTitleIds.length : 1;
      const message =
        watchedTitleIds.length < 3
          ? 'Mark at least three films as watched before starting a ranking round'
          : 'Mark another film as watched to start a new ranking round';
      // NestJS's default error shape plus the structured fields of the target
      // contract (API.md §2.2: `{ reason: 'need_more_watched', needed }`), so
      // the client can say exactly how many more films to mark instead of
      // parsing English prose.
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message,
        reason: 'need_more_watched',
        needed,
      });
    }

    const titleIds = titles.map((title) => title.id);

    try {
      const created = await this.triadsRepository.save(
        this.triadsRepository.create({
          profileId,
          titleIds,
          // Shuffled independently of titleIds so position bias in the UI can
          // be measured and corrected for (blueprint section 4.3).
          displayOrder: this.shuffle([...titleIds]),
          policyVersion: TRIAD_POLICY_VERSION,
          // Probability this exact unordered triple was selected: uniform
          // random draw of 3 from the eligible pool.
          selectionPropensity: 1 / this.combinations(poolSize, 3),
          status: 'active',
          shownAt: new Date(),
          metadata: { reasonForSelection: 'random-watched-unranked' },
        }),
      );
      return this.withItems(created);
    } catch (error) {
      if (!this.isUniqueConstraintError(error)) {
        throw error;
      }
      // Lost a race against a concurrent call for the same profile (DB
      // partial unique index IDX_triads_one_active_per_profile enforces at
      // most one active triad per profile): the winner's row is the current
      // one, so return that instead of a duplicate or an error.
      const winner = await this.triadsRepository.findOne({ where: { profileId, status: 'active' } });
      if (!winner) {
        throw error;
      }
      return this.withItems(winner);
    }
  }

  // Attach the three titles in displayOrder (falling back to titleIds for
  // legacy rows), selecting only the catalog's public columns.
  private async withItems(triad: Triad): Promise<TriadWithItems> {
    const order = triad.displayOrder ?? triad.titleIds ?? [];
    if (order.length === 0) {
      return { ...triad, items: [] };
    }
    const titles = await this.titlesRepository.find({
      where: { id: In(order) },
      select: {
        id: true,
        internalId: true,
        titleEn: true,
        titleAr: true,
        description: true,
        releaseYear: true,
        genres: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    const byId = new Map(titles.map((title) => [title.id, title as TriadItem]));
    const items = order.map((id) => byId.get(id)).filter((title): title is TriadItem => title !== undefined);
    return { ...triad, items };
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
  }

  async rank(
    userId: string,
    triadId: string,
    rankTriadDto: RankTriadDto,
    idempotencyKey?: string,
  ): Promise<TriadWithItems> {
    this.assertRankingShape(rankTriadDto.ranking);

    if (idempotencyKey) {
      if (!isUUID(idempotencyKey)) {
        throw new BadRequestException('Idempotency-Key must be a UUID');
      }
      const replay = await this.triadsRepository.findOne({ where: { idempotencyKey } });
      if (replay) {
        // Same key, same triad: this is a retry of a request that already
        // succeeded (network timeout, double-click) -- return that result
        // instead of erroring on "already submitted" (blueprint §14, ADR-15).
        // Same key, a *different* triad: the client reused a key it must
        // not have -- a real conflict, not a replay.
        if (replay.id !== triadId) {
          throw new ConflictException('Idempotency-Key was already used for a different triad');
        }
        await this.assertProfileOwnership(userId, replay.profileId);
        return this.withItems(replay);
      }
    }

    const triad = await this.triadsRepository.findOne({ where: { id: triadId } });
    if (!triad) {
      throw new NotFoundException('Triad not found');
    }
    await this.assertProfileOwnership(userId, triad.profileId);

    if (triad.status !== 'active') {
      throw new BadRequestException('This triad has already been submitted');
    }

    this.assertRankingMatchesTriad(rankTriadDto.ranking, triad.titleIds);

    triad.ranking = rankTriadDto.ranking;
    triad.answeredAt = new Date();
    triad.sessionId = rankTriadDto.sessionId ?? triad.sessionId;
    triad.idempotencyKey = idempotencyKey ?? null;
    triad.status = 'completed';

    try {
      return this.withItems(await this.triadsRepository.save(triad));
    } catch (error) {
      if (!idempotencyKey || !this.isUniqueConstraintError(error)) {
        throw error;
      }
      // Lost a race to a concurrent identical retry that saved first: the
      // winner already persisted this key, so return its result instead of
      // erroring or leaving this attempt's caller with a duplicate write.
      const winner = await this.triadsRepository.findOne({ where: { idempotencyKey } });
      if (!winner) {
        throw error;
      }
      return this.withItems(winner);
    }
  }

  // One of the two neutral replacement controls (blueprint §4.3, ADR-17):
  // the user says "haven't watched" or "don't remember" about one item, that
  // item alone is swapped for another eligible watched title, and the triad
  // gets a fresh displayOrder. The reason is exposure bookkeeping, never a
  // preference -- nothing here enters training, a prior or a score.
  async replace(userId: string, triadId: string, replaceTriadItemDto: ReplaceTriadItemDto): Promise<TriadWithItems> {
    const triad = await this.triadsRepository.findOne({ where: { id: triadId } });
    if (!triad) {
      throw new NotFoundException('Triad not found');
    }
    await this.assertProfileOwnership(userId, triad.profileId);

    if (triad.status !== 'active') {
      throw new BadRequestException('Only an active triad can have an item replaced');
    }
    if (!triad.titleIds.includes(replaceTriadItemDto.titleId)) {
      throw new BadRequestException("Title is not one of this triad's three title ids");
    }

    const priorReplacements = await this.replacementsRepository.count({ where: { triadId } });
    const replacementTitleId =
      priorReplacements < MAX_REPLACEMENTS_PER_TRIAD
        ? await this.pickReplacementTitle(triad.profileId, triad.titleIds)
        : null;

    // One transaction: the exposure change, the event row and the triad
    // update all land or none do -- a triad must never keep showing a title
    // the user just said they haven't watched.
    const updated = await this.triadsRepository.manager.transaction(async (manager) => {
      await this.applyReplacementReason(
        manager,
        triad.profileId,
        replaceTriadItemDto.titleId,
        replaceTriadItemDto.reason,
      );

      // Append-only event (SCHEMA.md §2.3); replacementTitleId stays NULL
      // when nothing could be swapped in.
      await manager.save(
        manager.create(TriadReplacement, {
          triadId: triad.id,
          replacedTitleId: replaceTriadItemDto.titleId,
          replacementTitleId,
          reason: replaceTriadItemDto.reason,
        }),
      );

      if (replacementTitleId) {
        // Same slot, new title; displayOrder is re-drawn so the swapped-in
        // card's position is as unbiased as the original draw (ADR-17).
        triad.titleIds = triad.titleIds.map((id) => (id === replaceTriadItemDto.titleId ? replacementTitleId : id));
        triad.displayOrder = this.shuffle([...triad.titleIds]);
      } else {
        // Nothing eligible left, or the per-triad limit is exceeded: the
        // event above is still recorded, the triad is abandoned rather than
        // patched. The next getCurrent() draws a fresh one -- or says exactly
        // how many more watched titles it needs.
        triad.status = 'skipped';
      }
      return manager.save(triad);
    });
    return this.withItems(updated);
  }

  async findCompleted(userId: string, profileId: string): Promise<Triad[]> {
    await this.assertProfileOwnership(userId, profileId);
    return this.triadsRepository.find({
      where: { profileId, status: 'completed' },
      order: { createdAt: 'DESC' },
    });
  }

  // The neutral bookkeeping each replacement reason implies (ADR-17).
  private async applyReplacementReason(
    manager: EntityManager,
    profileId: string,
    titleId: string,
    reason: ReplacementReason,
  ): Promise<void> {
    const existing = await manager.findOne(UserTitleState, { where: { profileId, titleId } });
    const state = existing ?? manager.create(UserTitleState, { profileId, titleId, state: 'watched' });
    if (reason === 'not_watched') {
      // Exposure unknown: the title leaves the watched set (and so the triad
      // pool) and stays a recommendation candidate (BP §2.4 #3).
      state.state = 'not_watched';
      state.watchedAt = null;
    } else {
      // Watched but not recallable: still not recommendable, and never asked
      // about in a triad again.
      state.triadEligible = false;
    }
    await manager.save(state);
  }

  // A random watched, still-eligible title that is in neither the triad nor
  // the immediately previous completed triad -- the same one-triad lookback
  // getCurrent() applies (ADR-34). null when the pool has nothing left.
  private async pickReplacementTitle(profileId: string, currentTitleIds: string[]): Promise<string | null> {
    const previousTriad = await this.triadsRepository.findOne({
      where: { profileId, status: 'completed' },
      order: { createdAt: 'DESC' },
      select: { titleIds: true },
    });
    const excluded = new Set([...currentTitleIds, ...(previousTriad?.titleIds ?? [])]);
    const candidates = (await this.eligibleWatchedTitleIds(profileId)).filter((id) => !excluded.has(id));
    if (candidates.length === 0) {
      return null;
    }
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  // Watched titles the user can still be asked about: "don't remember"
  // clears triadEligible while keeping the watch (ADR-17).
  private async eligibleWatchedTitleIds(profileId: string): Promise<string[]> {
    const watchedStates = await this.statesRepository.find({
      where: { profileId, state: 'watched', triadEligible: true },
      select: { titleId: true },
    });
    return watchedStates.map((state) => state.titleId);
  }

  private async assertProfileOwnership(userId: string, profileId: string): Promise<void> {
    const profile = await this.profilesRepository.findOne({ where: { id: profileId, userId } });
    if (!profile) {
      throw new NotFoundException('Profile not found');
    }
  }

  private async selectRandomTitles(watchedTitleIds: string[], recentlyUsedTitleIds: string[]): Promise<CandidateSelection> {
    if (watchedTitleIds.length < 3) {
      return { titles: [], poolSize: 0 };
    }
    const queryBuilder = this.titlesRepository.createQueryBuilder('title').orderBy('RANDOM()').take(3);
    queryBuilder.where('title.id IN (:...watchedTitleIds)', { watchedTitleIds });
    if (recentlyUsedTitleIds.length > 0) {
      queryBuilder.andWhere('title.id NOT IN (:...recentlyUsedTitleIds)', { recentlyUsedTitleIds });
    }
    // getManyAndCount() runs the COUNT without the take(3)/LIMIT, so
    // poolSize is the full eligible pool, not just the 3 selected.
    const [titles, poolSize] = await queryBuilder.getManyAndCount();
    return { titles, poolSize };
  }

  // Shape only: no DB access, so this runs before the triad is even fetched.
  private assertRankingShape(ranking: string[]): void {
    if (
      !Array.isArray(ranking) ||
      ranking.length !== 3 ||
      new Set(ranking).size !== 3 ||
      !ranking.every((id) => isUUID(id))
    ) {
      throw new BadRequestException('Ranking must contain exactly 3 distinct title ids');
    }
  }

  // Semantic: the submitted ranking must be exactly this triad's own three
  // title ids (in some order), never a different set. Needs the fetched
  // triad row, so it runs after assertRankingShape, not instead of it.
  private assertRankingMatchesTriad(ranking: string[], titleIds: string[]): void {
    const rankingSet = new Set(ranking);
    const titleIdSet = new Set(titleIds);
    const sameSet = rankingSet.size === titleIdSet.size && [...rankingSet].every((id) => titleIdSet.has(id));
    if (!sameSet) {
      throw new BadRequestException("Ranking must be exactly this triad's three title ids");
    }
  }

  private shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }

  private combinations(n: number, k: number): number {
    if (k > n || k < 0) {
      return 0;
    }
    let result = 1;
    for (let i = 0; i < k; i += 1) {
      result = (result * (n - i)) / (i + 1);
    }
    return result;
  }
}
