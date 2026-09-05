import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { Profile } from '../../entities/profile.entity';
import { Title } from '../../entities/title.entity';
import { UserTitleState } from '../../entities/user-title-state.entity';
import { UserTitleStateService } from './user-title-state.service';

function repoMock() {
  return {
    findOne: vi.fn(),
    find: vi.fn(),
    save: vi.fn(async (entity: unknown) => entity),
    create: vi.fn((data: unknown) => data),
  };
}

describe('UserTitleStateService', () => {
  let profilesRepository: ReturnType<typeof repoMock>;
  let titlesRepository: ReturnType<typeof repoMock>;
  let statesRepository: ReturnType<typeof repoMock>;
  let service: UserTitleStateService;

  beforeEach(() => {
    profilesRepository = repoMock();
    titlesRepository = repoMock();
    statesRepository = repoMock();
    service = new UserTitleStateService(
      profilesRepository as unknown as Repository<Profile>,
      titlesRepository as unknown as Repository<Title>,
      statesRepository as unknown as Repository<UserTitleState>,
    );
  });

  describe('upsert', () => {
    it('rejects setting state on a profile owned by another user', async () => {
      profilesRepository.findOne.mockResolvedValue(null);

      await expect(
        service.upsert('attacker-user', 'someone-elses-profile', 'title-1', { state: 'watched' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(titlesRepository.findOne).not.toHaveBeenCalled();
      expect(statesRepository.save).not.toHaveBeenCalled();
    });

    it('rejects an unknown title id', async () => {
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      titlesRepository.findOne.mockResolvedValue(null);

      await expect(
        service.upsert('user-1', 'profile-1', 'missing-title', { state: 'watched' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('stamps watchedAt automatically the first time a title is marked watched, but never guesses watchedOn', async () => {
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      titlesRepository.findOne.mockResolvedValue({ id: 'title-1' });
      statesRepository.findOne.mockResolvedValue(null);

      const result = await service.upsert('user-1', 'profile-1', 'title-1', { state: 'watched' });

      expect(result.watchedAt).toBeInstanceOf(Date);
      expect(result.state).toBe('watched');
      // ADR-104/DATE-01: an unsupplied day stays unknown (NULL), never
      // defaulted from this server's own UTC clock -- the exact bug found
      // live (a Riyadh user just after local midnight got the previous day).
      expect(result.watchedOn).toBeNull();
    });

    // ADR-104: the client always supplies its own local calendar day when
    // marking watched (lib/format.ts's todayLocal(), or the diary's chosen
    // date) -- this is what actually fixes DATE-01, not a server-side guess.
    it('records the client-supplied watchedOn when marking watched', async () => {
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      titlesRepository.findOne.mockResolvedValue({ id: 'title-1' });
      statesRepository.findOne.mockResolvedValue(null);

      const result = await service.upsert('user-1', 'profile-1', 'title-1', { state: 'watched', watchedOn: '2026-09-05' });

      expect(result.watchedOn).toBe('2026-09-05');
    });

    // The diary saving only a note must never move the date it did not
    // touch -- the second live bug DATE-01 found (editing the note changed
    // the displayed date because the old code always resent watchedAt).
    it('leaves an already-set watchedOn untouched when a notes-only PATCH omits it', async () => {
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      titlesRepository.findOne.mockResolvedValue({ id: 'title-1' });
      statesRepository.findOne.mockResolvedValue({
        profileId: 'profile-1',
        titleId: 'title-1',
        state: 'watched',
        watchedAt: new Date('2026-09-01T12:00:00Z'),
        watchedOn: '2026-09-01',
      });

      const result = await service.upsert('user-1', 'profile-1', 'title-1', { state: 'watched', notes: 'loved it' });

      expect(result.watchedOn).toBe('2026-09-01');
    });

    // The diary can also correct the date -- an explicit watchedOn always wins.
    it('updates watchedOn when the diary corrects it', async () => {
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      titlesRepository.findOne.mockResolvedValue({ id: 'title-1' });
      statesRepository.findOne.mockResolvedValue({
        profileId: 'profile-1',
        titleId: 'title-1',
        state: 'watched',
        watchedAt: new Date('2026-09-01T12:00:00Z'),
        watchedOn: '2026-09-01',
      });

      const result = await service.upsert('user-1', 'profile-1', 'title-1', { state: 'watched', watchedOn: '2026-08-30' });

      expect(result.watchedOn).toBe('2026-08-30');
    });

    it('clears watchedAt and watchedOn when the state changes away from watched', async () => {
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      titlesRepository.findOne.mockResolvedValue({ id: 'title-1' });
      statesRepository.findOne.mockResolvedValue({
        profileId: 'profile-1',
        titleId: 'title-1',
        state: 'watched',
        watchedAt: new Date('2026-01-01'),
        watchedOn: '2026-01-01',
      });

      const result = await service.upsert('user-1', 'profile-1', 'title-1', { state: 'watchlist' });

      expect(result.watchedAt).toBeNull();
      expect(result.watchedOn).toBeNull();
      expect(result.state).toBe('watchlist');
    });

    // M1/ADR-104: neither field means anything for a state other than
    // 'watched' -- a caller supplying one anyway must not have it stored.
    it('ignores a supplied watchedOn when the state is not watched', async () => {
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      titlesRepository.findOne.mockResolvedValue({ id: 'title-1' });
      statesRepository.findOne.mockResolvedValue(null);

      const result = await service.upsert('user-1', 'profile-1', 'title-1', {
        state: 'watchlist',
        watchedOn: '2020-01-01',
      });

      expect(result.watchedAt).toBeNull();
      expect(result.watchedOn).toBeNull();
    });

    // M1: PATCH semantics -- omitting `notes` must leave an existing value
    // alone, not silently wipe it.
    it('leaves existing notes untouched when the PATCH omits the field', async () => {
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      titlesRepository.findOne.mockResolvedValue({ id: 'title-1' });
      statesRepository.findOne.mockResolvedValue({
        profileId: 'profile-1',
        titleId: 'title-1',
        state: 'watched',
        watchedAt: new Date('2026-01-01'),
        notes: 'loved the score',
      });

      const result = await service.upsert('user-1', 'profile-1', 'title-1', { state: 'watched' });

      expect(result.notes).toBe('loved the score');
    });

    it('writes notes when the PATCH includes the field', async () => {
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      titlesRepository.findOne.mockResolvedValue({ id: 'title-1' });
      statesRepository.findOne.mockResolvedValue(null);

      const result = await service.upsert('user-1', 'profile-1', 'title-1', {
        state: 'watched',
        notes: 'rewatch candidate',
      });

      expect(result.notes).toBe('rewatch candidate');
    });

    it('clears notes when the PATCH explicitly sends null', async () => {
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      titlesRepository.findOne.mockResolvedValue({ id: 'title-1' });
      statesRepository.findOne.mockResolvedValue({
        profileId: 'profile-1',
        titleId: 'title-1',
        state: 'watched',
        watchedAt: new Date('2026-01-01'),
        notes: 'loved the score',
      });

      const result = await service.upsert('user-1', 'profile-1', 'title-1', { state: 'watched', notes: null });

      expect(result.notes).toBeNull();
    });

    // H2: two concurrent first writes for the same (profile, title) -- the
    // DB unique constraint refuses the loser's INSERT, and the loser must
    // apply its PATCH on top of the winner's row rather than surface a 500.
    it("applies the update on top of the winner's row instead of erroring when it loses a race to create the same state", async () => {
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      titlesRepository.findOne.mockResolvedValue({ id: 'title-1' });
      const winner = {
        id: 'state-1',
        profileId: 'profile-1',
        titleId: 'title-1',
        state: 'watchlist',
        watchedAt: null,
        notes: 'from the winner',
      };
      statesRepository.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(winner);
      statesRepository.save.mockRejectedValueOnce({ code: '23505' });

      const result = await service.upsert('user-1', 'profile-1', 'title-1', { state: 'watched' });

      expect(result).toBe(winner);
      expect(result).toMatchObject({ id: 'state-1', state: 'watched', notes: 'from the winner' });
      expect(result.watchedAt).toBeInstanceOf(Date);
      expect(statesRepository.save).toHaveBeenCalledTimes(2);
    });

    it('does not swallow a save error unrelated to the unique constraint', async () => {
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      titlesRepository.findOne.mockResolvedValue({ id: 'title-1' });
      statesRepository.findOne.mockResolvedValue(null);
      statesRepository.save.mockRejectedValueOnce(new Error('connection reset'));

      await expect(service.upsert('user-1', 'profile-1', 'title-1', { state: 'watched' })).rejects.toThrow(
        'connection reset',
      );
      expect(statesRepository.save).toHaveBeenCalledTimes(1);
    });

    it('rethrows a unique violation on an update of a row it already found, which cannot be this race', async () => {
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      titlesRepository.findOne.mockResolvedValue({ id: 'title-1' });
      statesRepository.findOne.mockResolvedValue({ id: 'state-1', profileId: 'profile-1', titleId: 'title-1', state: 'watched' });
      statesRepository.save.mockRejectedValueOnce({ code: '23505' });

      await expect(service.upsert('user-1', 'profile-1', 'title-1', { state: 'watchlist' })).rejects.toEqual({
        code: '23505',
      });
      expect(statesRepository.findOne).toHaveBeenCalledTimes(1);
    });
  });

  describe('findByState', () => {
    it('rejects listing state for a profile owned by another user', async () => {
      profilesRepository.findOne.mockResolvedValue(null);

      await expect(service.findByState('attacker-user', 'someone-elses-profile', 'watched')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(statesRepository.find).not.toHaveBeenCalled();
    });
  });
});
