import '../../jest-dom-vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OnboardingScreen } from '../components/OnboardingScreen';

const mocks = vi.hoisted(() => ({
  getWatchedTitles: vi.fn(),
  updateProfile: vi.fn(),
  updateConsents: vi.fn(),
  refreshProfile: vi.fn(),
}));

vi.mock('../lib/session', () => ({
  useSession: () => ({
    profile: { id: 'p1', preferredLanguage: 'en', market: 'SA', platforms: ['netflix'] },
    refreshProfile: mocks.refreshProfile,
  }),
}));

vi.mock('../lib/api', () => ({
  api: mocks,
  CONSENT_VERSION: 'test-version',
  ApiError: class ApiError extends Error {},
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getWatchedTitles.mockResolvedValue([]);
  mocks.updateProfile.mockResolvedValue({});
  mocks.updateConsents.mockResolvedValue([]);
  mocks.refreshProfile.mockResolvedValue(undefined);
});

describe('OnboardingScreen pending choices', () => {
  it('locks preference choices and Later until the write and confirming refresh both finish', async () => {
    const user = userEvent.setup();
    const write = deferred<object>();
    const refresh = deferred<void>();
    mocks.updateProfile.mockReturnValue(write.promise);
    mocks.refreshProfile.mockReturnValue(refresh.promise);
    const onSkip = vi.fn();
    const onLanguageChange = vi.fn();
    render(<OnboardingScreen lang="en" onDone={vi.fn()} onSkip={onSkip} onLanguageChange={onLanguageChange} />);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(mocks.updateProfile).toHaveBeenCalledTimes(1));
    const market = screen.getByLabelText('Market');
    const netflix = screen.getByRole('button', { name: 'Netflix' });
    expect(market).toBeDisabled();
    expect(netflix).toBeDisabled();
    expect(screen.getByRole('button', { name: 'English' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Later' })).toBeDisabled();
    await user.click(netflix);
    await user.click(screen.getByRole('button', { name: 'Later' }));
    expect(netflix).toHaveAttribute('aria-pressed', 'true');
    expect(onSkip).not.toHaveBeenCalled();
    expect(mocks.updateProfile).toHaveBeenCalledWith('p1', { preferredLanguage: 'en', market: 'SA', platforms: ['netflix'] });

    await act(async () => { write.resolve({}); });
    expect(mocks.refreshProfile).toHaveBeenCalledTimes(1);
    expect(market).toBeDisabled();
    expect(onLanguageChange).not.toHaveBeenCalled();
    await act(async () => { refresh.resolve(); });
    expect(screen.getByRole('heading', { name: 'What we collect and why' })).toBeVisible();
    expect(onLanguageChange).toHaveBeenCalledWith('en');
  });

  it('keeps the submitted consent choices fixed and Back disabled until the consent request succeeds', async () => {
    const user = userEvent.setup();
    const write = deferred<object>();
    mocks.updateConsents.mockReturnValue(write.promise);
    const onDone = vi.fn();
    render(<OnboardingScreen lang="en" onDone={onDone} onSkip={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    const pooled = await screen.findByRole('switch', { name: 'Contribute to the shared model' });
    const analytics = screen.getByRole('switch', { name: 'Product analytics' });
    await user.click(pooled);
    await user.click(analytics);
    await user.click(screen.getByRole('button', { name: 'Start marking what you watched' }));
    expect(pooled).toBeDisabled();
    expect(analytics).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
    await user.click(pooled);
    await user.click(analytics);
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(pooled).not.toBeChecked();
    expect(analytics).toBeChecked();
    expect(onDone).not.toHaveBeenCalled();
    expect(mocks.updateConsents).toHaveBeenCalledExactlyOnceWith([
      { purpose: 'watch_history', version: 'test-version', granted: true },
      { purpose: 'personalization_individual', version: 'test-version', granted: true },
      { purpose: 'personalization_pooled', version: 'test-version', granted: false },
      { purpose: 'analytics_first_party', version: 'test-version', granted: true },
    ]);

    await act(async () => { write.resolve({}); });
    expect(onDone).toHaveBeenCalledExactlyOnceWith('discover');
  });

  it('preserves consent choices and unlocks controls after a failure so the user can amend and retry', async () => {
    const user = userEvent.setup();
    const write = deferred<object>();
    mocks.updateConsents.mockReturnValueOnce(write.promise);
    const onDone = vi.fn();
    render(<OnboardingScreen lang="en" onDone={onDone} onSkip={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    const analytics = await screen.findByRole('switch', { name: 'Product analytics' });
    await user.click(analytics);
    await user.click(screen.getByRole('button', { name: 'Start marking what you watched' }));
    expect(analytics).toBeDisabled();
    await act(async () => { write.reject(new Error('offline')); });
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save. Please try again.');
    expect(analytics).toBeEnabled();
    expect(analytics).toBeChecked();
    expect(screen.getByRole('button', { name: 'Back' })).toBeEnabled();
    expect(onDone).not.toHaveBeenCalled();
    await user.click(analytics);
    await user.click(screen.getByRole('button', { name: 'Start marking what you watched' }));
    expect(mocks.updateConsents).toHaveBeenCalledTimes(2);
    expect(mocks.updateConsents.mock.calls[1][0]).toContainEqual({ purpose: 'analytics_first_party', version: 'test-version', granted: false });
    expect(onDone).toHaveBeenCalledExactlyOnceWith('discover');
  });
});
