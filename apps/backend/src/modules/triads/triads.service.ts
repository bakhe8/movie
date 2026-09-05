import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { isUUID } from 'class-validator';
import { EntityManager, In, Repository } from 'typeorm';
import { Outcome } from '../../entities/outcome.entity';
import { UserModelSnapshot } from '../../entities/user-model-snapshot.entity';
import { AnalyticsService } from '../analytics/analytics.service';
import { ExperimentsService, TRIAD_POLICY_EXPERIMENT } from '../experiments/experiments.service';
import { PosterService } from '../public-quality/poster.service';
import { ADAPTIVE_POLICY_VERSION, AdaptiveSelection, TriadPolicyService } from './triad-policy.service';
import { Profile } from '../../entities/profile.entity';
import { Recommendation } from '../../entities/recommendation.entity';
import { Title } from '../../entities/title.entity';
import { Triad } from '../../entities/triad.entity';
import { ReplacementReason, TriadReplacement } from '../../entities/triad-replacement.entity';
import { UserTitleState } from '../../entities/user-title-state.entity';
import { RankTriadDto } from './dto/rank-triad.dto';
import { ReplaceTriadItemDto } from './dto/replace-triad-item.dto';
import { triadSetHash, type TriadPurpose } from './triad-set';

// Bumped whenever the triad-selection policy changes; see
// docs/movie_taste_platform_blueprint_ar.md section 13.2 (triad_events).
// random-v2 (ADR-99): random-v1 plus "never a completed set while an unseen
// one exists", and a `verify` label when none is.
const TRIAD_POLICY_VERSION = 'random-v2';

// findLearnSet(): how many random draws to try before enumerating the pool's
// sets, and the largest pool (by number of sets, C(n,3) -- 5000 is n ≤ 32)
// that is enumerated at all. Past that, twelve misses in a row means the
// history is, for any real profile, exhausted.
const RANDOM_DRAWS_BEFORE_ENUMERATION = 12;
const MAX_SETS_TO_ENUMERATE = 5000;

// Policy parameter (ADR-17): a triad that would need more than this many
// replacements is abandoned (`skipped`) rather than patched indefinitely.
// ADR-17 leaves the value to be "set before the Phase 0 test"; this is the
// interim number, and the replacement rate it produces is itself a Phase 0
// metric (BP §17.1).
const MAX_REPLACEMENTS_PER_TRIAD = 3;

// What getCurrent() decided to ask, before the row exists.
interface TriadSelection {
  titleIds: string[];
  selectionPropensity: number;
  purpose: TriadPurpose;
  reasonForSelection: string;
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

// GET .../triads/current answers with a round or with why there isn't one.
// `state: 'ready'` rides along on the triad object so an existing reader of
// the triad fields keeps working (board B→A).
export type CurrentTriadResponse =
  | (TriadWithItems & { state: 'ready' })
  | { state: 'need_more_watched'; needed: number; message: string };

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
    @InjectRepository(Recommendation)
    private readonly recommendationsRepository: Repository<Recommendation>,
    @InjectRepository(Outcome)
    private readonly outcomesRepository: Repository<Outcome>,
    private readonly posterService: PosterService,
    @InjectRepository(UserModelSnapshot)
    private readonly snapshotsRepository: Repository<UserModelSnapshot>,
    private readonly experimentsService: ExperimentsService,
    private readonly triadPolicyService: TriadPolicyService,
    private readonly analyticsService: AnalyticsService,
  ) {}

  async getCurrent(userId: string, profileId: string): Promise<CurrentTriadResponse> {
    await this.assertProfileOwnership(userId, profileId);

    const activeTriad = await this.triadsRepository.findOne({
      where: { profileId, status: 'active' },
      order: { createdAt: 'ASC' },
    });
    if (activeTriad) {
      return { ...(await this.withItems(activeTriad)), state: 'ready' };
    }

    // Two exclusions, in order of precedence (ADR-99, revising ADR-34). A
    // *set* this profile has already completed is never asked again while an
    // unseen set exists: the live round of 2026-09-05 got round 2's exact
    // films back in round 4 and saw it counted as progress. Among the unseen
    // sets, the immediately previous triad's titles are avoided first, as a
    // fatigue stand-in for BP §8.2's -λr·Repeat that random-v1 has no score
    // to express. Repetition is still not a permanent ban -- BP §8.1 names
    // re-testing a past comparison ("verification/refutation in an
    // independent context") as one of the six triad functions -- so once
    // every set is used the round is drawn anyway, labelled `verify`, and
    // counts toward nothing (brief P0-04).
    const previousTriad = await this.triadsRepository.findOne({
      where: { profileId, status: 'completed' },
      order: { createdAt: 'DESC' },
      select: { titleIds: true },
    });
    const recentlyUsedTitleIds = previousTriad?.titleIds ?? [];
    const watchedTitleIds = await this.eligibleWatchedTitleIds(profileId);
    if (watchedTitleIds.length < 3) {
      // A designed product state, not an error: 200 with a discriminator so
      // the screen can say exactly how many more films to mark, and the
      // browser console stays clean (board B→A; API.md §2.2). 4xx here is
      // reserved for real errors -- 401, or 404 for someone else's profile.
      //
      // `needed` is the real remainder, never a constant: three watched
      // titles are what a triad needs, so what is missing is 3 minus what
      // the profile has (ADR-108). Below three there is nothing else that
      // can block a round, so this is the only `need_more_watched` state.
      return {
        state: 'need_more_watched',
        needed: 3 - watchedTitleIds.length,
        message: 'Mark at least three films as watched before starting a ranking round',
      };
    }
    // Fatigue is a preference, not a ban (ADR-108, revising ADR-34's H1):
    // resting the titles of the round just completed is worth doing when
    // the profile has other watched films, and worth nothing when it does
    // not -- a profile with exactly three watched films was told "mark
    // another film" forever, which reads as a wall where the honest answer
    // is a repeat round labelled `verify` that counts toward no threshold.
    const restedTitleIds = watchedTitleIds.filter((id) => !recentlyUsedTitleIds.includes(id));
    const pool = restedTitleIds.length >= 3 ? restedTitleIds : watchedTitleIds;
    const usedSetHashes = await this.completedSetHashes(profileId);

    // ALPHA_PLAN 6.2/6.5: the adaptive policy runs only for profiles the
    // `triad-policy` experiment put in that arm; everyone else keeps the
    // random policy as the control, and both record which policy chose them.
    const adaptive = await this.adaptiveSelection(profileId, pool, recentlyUsedTitleIds, usedSetHashes);
    let selection: TriadSelection;
    if (adaptive) {
      selection = { ...adaptive, purpose: 'learn', reasonForSelection: 'adaptive-uncertainty' };
    } else {
      const learn = this.findLearnSet(pool, usedSetHashes);
      selection = learn
        ? {
            titleIds: learn.titleIds,
            // The probability this policy chose this triple: uniform over
            // the pool it was drawn from (RANKING_ALGORITHM §9).
            selectionPropensity: 1 / this.combinations(learn.poolSize, 3),
            purpose: 'learn',
            reasonForSelection: 'random-watched-unranked',
          }
        : {
            // Every set the pool can make is already answered: still not a
            // permanent ban (BP §8.1's re-testing function). Drawn from the
            // rested pool when one exists, so it repeats the round just
            // completed only when nothing else is left to draw.
            titleIds: this.shuffle([...pool]).slice(0, 3),
            selectionPropensity: 1 / this.combinations(pool.length, 3),
            purpose: 'verify',
            reasonForSelection: 'random-verify-repeat',
          };
    }
    const policyVersion = adaptive ? ADAPTIVE_POLICY_VERSION : TRIAD_POLICY_VERSION;

    try {
      const created = await this.triadsRepository.save(
        this.triadsRepository.create({
          profileId,
          titleIds: selection.titleIds,
          setHash: triadSetHash(selection.titleIds),
          purpose: selection.purpose,
          countsTowardActivation: selection.purpose === 'learn',
          // Shuffled independently of titleIds so position bias in the UI can
          // be measured and corrected for (blueprint section 4.3) -- and so a
          // verify round never shows the order the user gave last time.
          displayOrder: this.shuffle([...selection.titleIds]),
          policyVersion,
          selectionPropensity: selection.selectionPropensity,
          status: 'active',
          shownAt: new Date(),
          metadata: { reasonForSelection: selection.reasonForSelection },
        }),
      );
      return { ...(await this.withItems(created)), state: 'ready' };
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
      return { ...(await this.withItems(winner)), state: 'ready' };
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
        posterPath: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    // Every surface that shows a film shows its poster (board B4, ADR-82).
    const withPosters = await this.posterService.attach(titles);
    const byId = new Map(withPosters.map((title) => [title.id, title as unknown as TriadItem]));
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
      const saved = await this.triadsRepository.save(triad);
      await this.recordRankedOutcomes(saved);
      // ALPHA_PLAN 7.5's triad timing, measured server-side from the two
      // stamps the row already carries rather than trusted from a client.
      // Recorded after the save, so a failure here cannot cost the answer.
      await this.analyticsService.record(
        saved.profileId,
        'triad_answered',
        {
          // Omitted, not zeroed or sentinelled, when the round was never
          // marked shown (ADR-19: unknown is not a value).
          ...(this.roundDurationMs(saved) !== null ? { durationMs: this.roundDurationMs(saved) as number } : {}),
          ...(saved.modelVersion ? { policy: saved.modelVersion } : {}),
        },
        saved.answeredAt ?? new Date(),
      );
      return this.withItems(saved);
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

  // BP §4.5's "compare prediction to real ranking" arrow, the one piece of
  // the post-watch loop ADR-66/ADR-67 left open (blueprint gap 4, in full):
  // when a title that was previously recommended (RecommendationsService.
  // findForProfile(), ADR-58) turns up ranked in a just-completed triad,
  // that comparison is now possible. One outcomes row per such title, not
  // per triad -- each carries its own rankPosition and the specific
  // recommendation it traces back to, mirroring OutcomesService's own
  // append-only convention (ADR-67). A title never recommended writes
  // nothing; most triads today are drawn straight from watched titles with
  // no recommendation history, so that's the common case, not a bug. Only
  // called from the fresh-completion path in rank() -- never from an
  // How long the round took, from the two stamps the row already carries.
  // null when the triad was never marked shown (older rows, ADR-32) -- never
  // guessed, and never zero, which would read as an impossibly fast answer.
  private roundDurationMs(triad: Triad): number | null {
    if (!triad.shownAt || !triad.answeredAt) {
      return null;
    }
    const elapsed = triad.answeredAt.getTime() - triad.shownAt.getTime();
    return elapsed >= 0 ? elapsed : null;
  }

  // idempotent replay or a lost-race retry, both of which return a triad
  // the winning attempt already recorded outcomes for.
  private async recordRankedOutcomes(triad: Triad): Promise<void> {
    const ranking = triad.ranking;
    if (!ranking) {
      return;
    }
    for (const [rankPosition, titleId] of ranking.entries()) {
      const recommendation = await this.recommendationsRepository.findOne({
        where: { profileId: triad.profileId, titleId },
        order: { createdAt: 'DESC' },
      });
      if (!recommendation) {
        continue;
      }
      await this.outcomesRepository.save(
        this.outcomesRepository.create({
          recommendationId: recommendation.id,
          type: 'ranked_later',
          triadId: triad.id,
          rankPosition,
          occurredAt: triad.answeredAt ?? new Date(),
        }),
      );
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

    // One transaction: the exposure change, the event row and the triad
    // update all land or none do -- a triad must never keep showing a title
    // the user just said they haven't watched.
    const updated = await this.triadsRepository.manager.transaction(async (manager) => {
      // Row lock (SELECT ... FOR UPDATE): two concurrent calls for the same
      // triad -- a double-click, or a retry sent before the first response
      // arrives -- serialize here. Without it both pass the checks above on
      // the same stale read, both pick a title, and the later save()
      // overwrites the earlier swap while its event row still claims it
      // happened (AUDIT_2026-09-05 H3). Every decision below reads the
      // locked row, never the pre-transaction one.
      const locked = await manager.findOne(Triad, { where: { id: triadId }, lock: { mode: 'pessimistic_write' } });
      if (!locked) {
        throw new NotFoundException('Triad not found');
      }
      if (locked.status !== 'active') {
        throw new BadRequestException('Only an active triad can have an item replaced');
      }
      if (!locked.titleIds.includes(replaceTriadItemDto.titleId)) {
        // The other call already swapped this very title out: nothing is
        // left to replace, so hand back its result rather than log a second
        // event for a title no longer in the triad -- the same "return the
        // winner" answer getCurrent() and rank() give to a lost race.
        return locked;
      }

      const priorReplacements = await manager.count(TriadReplacement, { where: { triadId } });
      const usedSetHashes = await this.completedSetHashes(locked.profileId, manager);
      const replacementTitleId =
        priorReplacements < MAX_REPLACEMENTS_PER_TRIAD
          ? await this.pickReplacementTitle(locked.profileId, locked.titleIds, replaceTriadItemDto.titleId, usedSetHashes)
          : null;

      await this.applyReplacementReason(
        manager,
        locked.profileId,
        replaceTriadItemDto.titleId,
        replaceTriadItemDto.reason,
      );

      // Append-only event (SCHEMA.md §2.3); replacementTitleId stays NULL
      // when nothing could be swapped in.
      await manager.save(
        manager.create(TriadReplacement, {
          triadId: locked.id,
          replacedTitleId: replaceTriadItemDto.titleId,
          replacementTitleId,
          reason: replaceTriadItemDto.reason,
        }),
      );

      if (replacementTitleId) {
        // Same slot, new title; displayOrder is re-drawn so the swapped-in
        // card's position is as unbiased as the original draw (ADR-17).
        locked.titleIds = locked.titleIds.map((id) => (id === replaceTriadItemDto.titleId ? replacementTitleId : id));
        locked.displayOrder = this.shuffle([...locked.titleIds]);
        // The swapped-in set is a new question -- or, when nothing unseen
        // could be swapped in, a repeat, labelled exactly as a fresh draw
        // of it would be (ADR-99).
        locked.setHash = triadSetHash(locked.titleIds);
        locked.purpose = usedSetHashes.has(locked.setHash) ? 'verify' : 'learn';
        locked.countsTowardActivation = locked.purpose === 'learn';
      } else {
        // Nothing eligible left, or the per-triad limit is exceeded: the
        // event above is still recorded, the triad is abandoned rather than
        // patched. The next getCurrent() draws a fresh one -- or says exactly
        // how many more watched titles it needs.
        locked.status = 'skipped';
      }
      return manager.save(locked);
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
  // getCurrent() applies (ADR-34) -- preferring one that makes a set this
  // profile has not answered yet (ADR-99: a replacement yields a new
  // question when one exists). null when the pool has nothing left.
  private async pickReplacementTitle(
    profileId: string,
    currentTitleIds: string[],
    replacedTitleId: string,
    usedSetHashes: Set<string>,
  ): Promise<string | null> {
    const previousTriad = await this.triadsRepository.findOne({
      where: { profileId, status: 'completed' },
      order: { createdAt: 'DESC' },
      select: { titleIds: true },
    });
    const excluded = new Set([...currentTitleIds, ...(previousTriad?.titleIds ?? [])]);
    const candidates = this.shuffle((await this.eligibleWatchedTitleIds(profileId)).filter((id) => !excluded.has(id)));
    if (candidates.length === 0) {
      return null;
    }
    const kept = currentTitleIds.filter((id) => id !== replacedTitleId);
    return candidates.find((id) => !usedSetHashes.has(triadSetHash([...kept, id]))) ?? candidates[0];
  }

  // Every set this profile has completed, as hashes (triad-set.ts). Rows
  // from before the column existed are hashed here from their titleIds, so
  // a half-backfilled table still answers correctly.
  private async completedSetHashes(profileId: string, manager?: EntityManager): Promise<Set<string>> {
    const options = { where: { profileId, status: 'completed' as const }, select: { setHash: true, titleIds: true } };
    const rows = manager ? await manager.find(Triad, options) : await this.triadsRepository.find(options);
    return new Set(rows.map((row) => row.setHash ?? triadSetHash(row.titleIds)));
  }

  // An unseen set of three from `pool`, or null when every set in it has
  // been completed. Random draws first; when they keep landing on used sets
  // and the pool is small enough, every set in a random order -- so a free
  // set is never missed while one exists (brief P0-04's acceptance line: no
  // unlabelled repeat while an alternative is available).
  private findLearnSet(pool: string[], usedSetHashes: Set<string>): { titleIds: string[]; poolSize: number } | null {
    const poolSize = pool.length;
    if (poolSize < 3) {
      return null;
    }
    for (let attempt = 0; attempt < RANDOM_DRAWS_BEFORE_ENUMERATION; attempt += 1) {
      const titleIds = this.shuffle([...pool]).slice(0, 3);
      if (!usedSetHashes.has(triadSetHash(titleIds))) {
        return { titleIds, poolSize };
      }
    }
    if (this.combinations(poolSize, 3) > MAX_SETS_TO_ENUMERATE) {
      return null;
    }
    const order = this.shuffle([...pool]);
    for (let i = 0; i < order.length - 2; i += 1) {
      for (let j = i + 1; j < order.length - 1; j += 1) {
        for (let k = j + 1; k < order.length; k += 1) {
          const titleIds = [order[i], order[j], order[k]];
          if (!usedSetHashes.has(triadSetHash(titleIds))) {
            return { titleIds, poolSize };
          }
        }
      }
    }
    return null;
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

  // Null unless this profile is in the adaptive arm and a full pool could be
  // scored -- every failure path falls back to the control policy rather
  // than blocking a round.
  private async adaptiveSelection(
    profileId: string,
    restedTitleIds: string[],
    recentlyUsedTitleIds: string[],
    usedSetHashes: Set<string>,
  ): Promise<AdaptiveSelection | null> {
    const arm = await this.experimentsService.armFor(TRIAD_POLICY_EXPERIMENT, profileId);
    if (arm !== ADAPTIVE_POLICY_VERSION) {
      return null;
    }
    if (restedTitleIds.length < 3) {
      return null;
    }
    const pool = await this.titlesRepository.find({ where: { id: In(restedTitleIds) } });
    const snapshot = await this.snapshotsRepository.findOne({ where: { profileId }, order: { createdAt: 'DESC' } });
    return this.triadPolicyService.select(pool, snapshot, new Set(recentlyUsedTitleIds), Math.random, usedSetHashes);
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
