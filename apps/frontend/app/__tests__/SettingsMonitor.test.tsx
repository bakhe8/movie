import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsMonitor } from '../components/admin/monitoring/SettingsMonitor';

vi.mock('../lib/api', () => ({
  api: { adminGetSettings: vi.fn() },
}));

import { api } from '../lib/api';
const mockApi = api as unknown as { adminGetSettings: ReturnType<typeof vi.fn> };

const SETTINGS = [
  {
    key: 'catalog.min_titles', name: 'أدنى عدد أفلام لبدء التدريب', description: 'x', unit: 'فيلم', type: 'number' as const,
    value: 200, source: 'default' as const, version: 0, needsRestart: false, modifiedBy: null, modifiedAt: null, reason: null,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockApi.adminGetSettings.mockResolvedValue(SETTINGS);
});

// ADMIN-W6 (plan §17.3): read-only registry view -- never imports a
// mutation client (the monitoring/administration split every section here
// follows).
describe('SettingsMonitor', () => {
  it('shows the plain-language source label instead of the raw enum', async () => {
    render(<SettingsMonitor />);
    await waitFor(() => expect(screen.getByText('أدنى عدد أفلام لبدء التدريب')).toBeInTheDocument());
    expect(screen.getByText('القيمة الافتراضية')).toBeInTheDocument();
    expect(screen.queryByText('default')).toBeNull();
    expect(screen.getByText('200 فيلم')).toBeInTheDocument();
  });

  it('shows a plain message instead of a raw null when never modified', async () => {
    render(<SettingsMonitor />);
    await waitFor(() => expect(screen.getByText('لم يُعدَّل بعد')).toBeInTheDocument());
  });
});
