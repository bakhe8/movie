import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CatalogMonitor } from '../components/admin/monitoring/CatalogMonitor';

const replace = vi.fn();
let currentParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => '/admin/monitoring/catalog',
  useSearchParams: () => currentParams,
}));

vi.mock('../lib/api', () => ({
  api: { adminGetTitles: vi.fn() },
}));

import { api } from '../lib/api';
const mockApi = api as unknown as { adminGetTitles: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.clearAllMocks();
  currentParams = new URLSearchParams();
  mockApi.adminGetTitles.mockResolvedValue({ items: [], total: 0, page: 1, limit: 50, totalPages: 0 });
});

// ADMIN-W2 (W0 preservation cases C1-C3): reload/back/forward must restore
// destination, filters and page -- proven here by the URL round-trip
// through useAdminQueryState rather than by any hidden component state.
// Real timers throughout: the 300ms debounce is waited out via `waitFor`
// rather than faked, which sidesteps fake-timer/userEvent interaction
// pitfalls entirely.
describe('CatalogMonitor URL state', () => {
  it('hydrates the search box and missing-filter from an existing URL', async () => {
    currentParams = new URLSearchParams({ query: 'amelie', missing: 'v2', page: '3' });
    render(<CatalogMonitor />);

    expect((screen.getByPlaceholderText('بحث في العنوان أو المعرف...') as HTMLInputElement).value).toBe('amelie');
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('v2');
    await waitFor(() => expect(mockApi.adminGetTitles).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'amelie', missing: 'v2', page: 3 }),
    ));
  });

  it('writes a debounced search into the URL and resets to page 1', async () => {
    currentParams = new URLSearchParams({ page: '4' });
    render(<CatalogMonitor />);
    await waitFor(() => expect(mockApi.adminGetTitles).toHaveBeenCalledTimes(1));

    const input = screen.getByPlaceholderText('بحث في العنوان أو المعرف...');
    fireEvent.change(input, { target: { value: 'dune' } });

    await waitFor(
      () => expect(replace).toHaveBeenCalledWith(expect.stringContaining('query=dune'), { scroll: false }),
      { timeout: 2000 },
    );
    expect(replace).toHaveBeenCalledWith(expect.stringContaining('page=1'), { scroll: false });
  });

  it('changing the missing-filter resets to page 1 in the URL', async () => {
    currentParams = new URLSearchParams({ page: '5' });
    render(<CatalogMonitor />);
    await waitFor(() => expect(mockApi.adminGetTitles).toHaveBeenCalledTimes(1));

    await userEvent.selectOptions(screen.getByRole('combobox'), 'fingerprint');

    await waitFor(() => expect(replace).toHaveBeenCalledWith(expect.stringContaining('missing=fingerprint'), { scroll: false }));
    expect(replace).toHaveBeenCalledWith(expect.stringContaining('page=1'), { scroll: false });
  });
});
