import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AdminOpsService } from './admin-ops.service';

describe('AdminOpsService.updateUser', () => {
  const actor = { id: 'admin-1', role: 'admin', ip: null };
  let users: { findOne: ReturnType<typeof vi.fn>; save: ReturnType<typeof vi.fn> };
  let refreshTokens: { update: ReturnType<typeof vi.fn> };
  let profiles: { count: ReturnType<typeof vi.fn> };
  let audit: { record: ReturnType<typeof vi.fn> };
  let service: AdminOpsService;

  beforeEach(() => {
    users = {
      findOne: vi.fn(async () => ({ id: 'user-1', email: 'u@example.com', role: 'user', active: true, createdAt: new Date() })),
      save: vi.fn(async (user: unknown) => user),
    };
    refreshTokens = { update: vi.fn(async () => ({ affected: 2 })) };
    profiles = { count: vi.fn(async () => 1) };
    audit = { record: vi.fn(async () => ({})) };
    service = new AdminOpsService(users as never, profiles as never, refreshTokens as never, {} as never, {} as never, audit as never);
  });

  it('refuses an admin changing their own role or status', async () => {
    await expect(service.updateUser('admin-1', { active: false }, actor)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.updateUser('admin-1', { role: 'user' }, actor)).rejects.toBeInstanceOf(ForbiddenException);
    expect(users.findOne).not.toHaveBeenCalled();
  });

  it('404s for an unknown account', async () => {
    users.findOne.mockResolvedValueOnce(null);
    await expect(service.updateUser('ghost', { active: false }, actor)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('deactivation revokes every live session and the audit row names the change and the reason', async () => {
    const result = await service.updateUser('user-1', { active: false, reason: 'takeover' }, actor);
    expect(result).toMatchObject({ id: 'user-1', active: false, profiles: 1 });
    expect(refreshTokens.update).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1' }),
      expect.objectContaining({ revokedReason: 'deactivated' }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'admin.user.update', actorUserId: 'admin-1', reason: 'active=false; sessions revoked 2; takeover' }),
    );
  });

  it('promotion does not touch sessions', async () => {
    await service.updateUser('user-1', { role: 'admin' }, actor);
    expect(refreshTokens.update).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ reason: 'role=admin' }));
  });
});
