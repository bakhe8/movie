import '../../jest-dom-vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppearancePicker } from '../components/AppearancePicker';
import { AppearanceProvider, SessionAppearanceProvider, appearanceStorageKey } from '../lib/appearance';
import { api, type Profile } from '../lib/api';
import { useSession } from '../lib/session';

const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('../lib/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('../lib/api', () => ({ api: { updateProfile: vi.fn() } }));
vi.mock('../lib/session', () => ({ useSession: vi.fn() }));

const saved = (preferredAppearance: Profile['preferredAppearance']) => ({ preferredAppearance }) as Profile;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const attribute = () => document.documentElement.getAttribute('data-appearance');

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  document.documentElement.removeAttribute('data-appearance');
  document.documentElement.setAttribute('data-theme', 'dark');
});

describe('appearance selection', () => {
  it('restores the profile preference ahead of the device cache without writing to the server', () => {
    localStorage.setItem(appearanceStorageKey('profile-1'), 'montage');
    render(<AppearanceProvider profileId="profile-1" preferredAppearance="premiere"><AppearancePicker lang="en" /></AppearanceProvider>);
    expect(attribute()).toBe('premiere');
    expect(screen.getByRole('radio', { name: 'Premiere' })).toHaveAttribute('aria-checked', 'true');
    expect(api.updateProfile).not.toHaveBeenCalled();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('applies the choice immediately, then reports success only after the profile response', async () => {
    const user = userEvent.setup();
    const pending = deferred<Profile>();
    vi.mocked(api.updateProfile).mockReturnValue(pending.promise);
    render(<AppearanceProvider profileId="profile-1" lang="en"><AppearancePicker lang="en" /></AppearanceProvider>);

    await user.click(screen.getByRole('radio', { name: 'Montage' }));

    expect(attribute()).toBe('montage');
    expect(api.updateProfile).toHaveBeenCalledWith('profile-1', { preferredAppearance: 'montage' });
    expect(screen.getByText('Saving to your profile…')).toBeInTheDocument();
    expect(toast).not.toHaveBeenCalled();
    await act(async () => pending.resolve(saved('montage')));
    expect(screen.getByText('Saved to your profile')).toBeInTheDocument();
    expect(toast).toHaveBeenCalledWith('Appearance saved to your profile', { tone: 'success' });
  });

  it('serializes rapid choices and lets only the latest choice report completion', async () => {
    const user = userEvent.setup();
    const first = deferred<Profile>();
    const last = deferred<Profile>();
    vi.mocked(api.updateProfile).mockReturnValueOnce(first.promise).mockReturnValueOnce(last.promise);
    render(<AppearanceProvider profileId="profile-1"><AppearancePicker lang="en" /></AppearanceProvider>);

    await user.click(screen.getByRole('radio', { name: 'Premiere' }));
    await user.click(screen.getByRole('radio', { name: 'Montage' }));
    expect(attribute()).toBe('montage');
    expect(api.updateProfile).toHaveBeenCalledTimes(1);

    await act(async () => first.resolve(saved('premiere')));
    await waitFor(() => expect(api.updateProfile).toHaveBeenCalledTimes(2));
    expect(api.updateProfile).toHaveBeenLastCalledWith('profile-1', { preferredAppearance: 'montage' });
    expect(screen.getByText('Saving to your profile…')).toBeInTheDocument();
    expect(toast).not.toHaveBeenCalled();
    await act(async () => last.resolve(saved('montage')));
    expect(attribute()).toBe('montage');
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it('discards queued writes and late feedback when the active profile changes', async () => {
    const user = userEvent.setup();
    const pending = deferred<Profile>();
    vi.mocked(api.updateProfile).mockReturnValue(pending.promise);
    const { rerender } = render(<AppearanceProvider profileId="profile-1"><AppearancePicker lang="en" /></AppearanceProvider>);
    await user.click(screen.getByRole('radio', { name: 'Premiere' }));
    await user.click(screen.getByRole('radio', { name: 'Montage' }));

    rerender(<AppearanceProvider profileId="profile-2" preferredAppearance="cinema"><AppearancePicker lang="en" /></AppearanceProvider>);
    expect(attribute()).toBe('cinema');
    await act(async () => pending.resolve(saved('premiere')));
    expect(attribute()).toBe('cinema');
    expect(api.updateProfile).toHaveBeenCalledTimes(1);
    expect(toast).not.toHaveBeenCalled();
  });

  it('keeps a failed choice visible and supports an explicit save retry', async () => {
    const user = userEvent.setup();
    vi.mocked(api.updateProfile).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(saved('premiere'));
    render(<AppearanceProvider profileId="profile-1" lang="en"><AppearancePicker lang="en" /></AppearanceProvider>);
    await user.click(screen.getByRole('radio', { name: 'Premiere' }));
    await screen.findByRole('button', { name: 'Try saving again' });
    expect(attribute()).toBe('premiere');
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('could not be saved'), { tone: 'error' });

    await user.click(screen.getByRole('button', { name: 'Try saving again' }));
    await screen.findByText('Saved to your profile');
    expect(api.updateProfile).toHaveBeenCalledTimes(2);
  });

  it('does not claim success when the server ignores the appearance field', async () => {
    const user = userEvent.setup();
    vi.mocked(api.updateProfile).mockResolvedValue(saved(undefined));
    render(<AppearanceProvider profileId="profile-1"><AppearancePicker lang="en" /></AppearanceProvider>);
    await user.click(screen.getByRole('radio', { name: 'Premiere' }));
    expect(await screen.findByText('Not saved yet')).toBeInTheDocument();
    expect(toast).toHaveBeenCalledWith(expect.any(String), { tone: 'error' });
  });

  it('uses a separate guest preference after logout without inheriting an account style', async () => {
    const user = userEvent.setup();
    localStorage.setItem(appearanceStorageKey(null), 'montage');
    const { rerender } = render(<AppearanceProvider profileId="profile-1" preferredAppearance="premiere"><AppearancePicker lang="en" /></AppearanceProvider>);
    rerender(<AppearanceProvider lang="en"><AppearancePicker lang="en" /></AppearanceProvider>);
    expect(attribute()).toBe('montage');
    await user.click(screen.getByRole('radio', { name: 'Cinema' }));
    expect(localStorage.getItem(appearanceStorageKey(null))).toBe('cinema');
    expect(localStorage.getItem(appearanceStorageKey('profile-1'))).toBe('premiere');
    expect(api.updateProfile).not.toHaveBeenCalled();
  });

  it('still changes this visit when browser storage is blocked, with honest feedback', async () => {
    const user = userEvent.setup();
    const blocked = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    render(<AppearanceProvider lang="en"><AppearancePicker lang="en" /></AppearanceProvider>);
    await user.click(screen.getByRole('radio', { name: 'Montage' }));
    expect(attribute()).toBe('montage');
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('device storage is unavailable'), { tone: 'error' });
    blocked.mockRestore();
  });

  it('supports arrow selection with the direction of an Arabic radio group', async () => {
    const user = userEvent.setup();
    render(<AppearanceProvider><AppearancePicker lang="ar" /></AppearanceProvider>);
    screen.getByRole('radio', { name: 'سينما' }).focus();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('radio', { name: 'العرض الأول' })).toHaveFocus();
    expect(attribute()).toBe('premiere');
    await user.keyboard('{End}');
    expect(screen.getByRole('radio', { name: 'مونتاج' })).toHaveFocus();
    expect(attribute()).toBe('montage');
  });

  it('follows only the current profile storage key without an API write', () => {
    render(<AppearanceProvider profileId="profile-1" preferredAppearance="cinema"><AppearancePicker lang="en" /></AppearanceProvider>);
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: appearanceStorageKey('profile-2'), newValue: 'premiere' })));
    expect(attribute()).toBe('cinema');
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: appearanceStorageKey('profile-1'), newValue: 'montage' })));
    expect(attribute()).toBe('montage');
    expect(api.updateProfile).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: null })));
    expect(attribute()).toBe('cinema');
  });

  it('keeps the current explicit choice while saving when another tab changes storage', async () => {
    const user = userEvent.setup();
    const pending = deferred<Profile>();
    vi.mocked(api.updateProfile).mockReturnValue(pending.promise);
    render(<AppearanceProvider profileId="profile-1" preferredAppearance="cinema"><AppearancePicker lang="en" /></AppearanceProvider>);
    await user.click(screen.getByRole('radio', { name: 'Premiere' }));
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: appearanceStorageKey('profile-1'), newValue: 'montage' })));
    expect(attribute()).toBe('premiere');
    expect(screen.getByText('Saving to your profile…')).toBeInTheDocument();
    await act(async () => pending.resolve(saved('premiere')));
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: null })));
    expect(attribute()).toBe('premiere');
  });

  it('ignores a stale profile when the authenticated account has changed', async () => {
    const user = userEvent.setup();
    vi.mocked(useSession).mockReturnValue({
      user: { id: 'user-2' },
      profile: { id: 'profile-1', userId: 'user-1', preferredAppearance: 'premiere' },
    } as ReturnType<typeof useSession>);
    render(<SessionAppearanceProvider><AppearancePicker lang="en" /></SessionAppearanceProvider>);
    expect(attribute()).toBe('cinema');
    await user.click(screen.getByRole('radio', { name: 'Montage' }));
    expect(api.updateProfile).not.toHaveBeenCalled();
    expect(localStorage.getItem(appearanceStorageKey('profile-1'))).toBeNull();
    expect(localStorage.getItem(appearanceStorageKey(null))).toBe('montage');
  });
});
