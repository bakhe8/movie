import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { isUUID } from 'class-validator';
import { Repository } from 'typeorm';
import { Profile } from '../../entities/profile.entity';
import { Title } from '../../entities/title.entity';
import { Triad } from '../../entities/triad.entity';
import { UserTitleState } from '../../entities/user-title-state.entity';
import { RankTriadDto } from './dto/rank-triad.dto';

// Bumped whenever the triad-selection policy changes; see
// docs/movie_taste_platform_blueprint_ar.md section 13.2 (triad_events).
const TRIAD_POLICY_VERSION = 'random-v1';

interface CandidateSelection {
  titles: Title[];
  poolSize: number;
}

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
  ) {}

  async getCurrent(userId: string, profileId: string): Promise<Triad> {
    await this.assertProfileOwnership(userId, profileId);

    const activeTriad = await this.triadsRepository.findOne({
      where: { profileId, status: 'active' },
      order: { createdAt: 'ASC' },
    });
    if (activeTriad) {
      return activeTriad;
    }

    const rankedTriads = await this.triadsRepository.find({
      where: { profileId, status: 'completed' },
      select: { titleIds: true },
    });
    const rankedTitleIds = rankedTriads.flatMap((triad) => triad.titleIds);
    const watchedStates = await this.statesRepository.find({
      where: { profileId, state: 'watched' },
      select: { titleId: true },
    });
    const watchedTitleIds = watchedStates.map((state) => state.titleId);
    const { titles, poolSize } = await this.selectRandomTitles(watchedTitleIds, rankedTitleIds);

    if (titles.length < 3) {
      throw new BadRequestException('Mark at least three films as watched before starting a ranking round');
    }

    const titleIds = titles.map((title) => title.id);

    try {
      return await this.triadsRepository.save(
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
      return winner;
    }
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
  }

  async rank(userId: string, triadId: string, rankTriadDto: RankTriadDto, idempotencyKey?: string): Promise<Triad> {
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
        return replay;
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
      return await this.triadsRepository.save(triad);
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
      return winner;
    }
  }

  async findCompleted(userId: string, profileId: string): Promise<Triad[]> {
    await this.assertProfileOwnership(userId, profileId);
    return this.triadsRepository.find({
      where: { profileId, status: 'completed' },
      order: { createdAt: 'DESC' },
    });
  }

  private async assertProfileOwnership(userId: string, profileId: string): Promise<void> {
    const profile = await this.profilesRepository.findOne({ where: { id: profileId, userId } });
    if (!profile) {
      throw new NotFoundException('Profile not found');
    }
  }

  private async selectRandomTitles(watchedTitleIds: string[], rankedTitleIds: string[]): Promise<CandidateSelection> {
    if (watchedTitleIds.length < 3) {
      return { titles: [], poolSize: 0 };
    }
    const queryBuilder = this.titlesRepository.createQueryBuilder('title').orderBy('RANDOM()').take(3);
    queryBuilder.where('title.id IN (:...watchedTitleIds)', { watchedTitleIds });
    if (rankedTitleIds.length > 0) {
      queryBuilder.andWhere('title.id NOT IN (:...rankedTitleIds)', { rankedTitleIds });
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
