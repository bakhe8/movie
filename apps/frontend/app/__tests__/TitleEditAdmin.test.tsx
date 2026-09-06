import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TitleEditAdmin } from '../components/admin/administration/TitleEditAdmin';

let currentParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useSearchParams: () => currentParams,
}));

const { MockApiError } = vi.hoisted(() => ({
  MockApiError: class MockApiError extends Error {
    status: number;
    details: Record<string, unknown>;
    constructor(message: string, status: number, details: Record<string, unknown> = {}) {
      super(message);
      this.status = status;
      this.details = details;
    }
  },
}));

vi.mock('../lib/api', () => ({
  ApiError: MockApiError,
  api: {
    adminGetTitleDetail: vi.fn(),
    adminGetProvenance: vi.fn(),
    adminUpdateTitle: vi.fn(),
    adminUpdateSourceRecord: vi.fn(),
    adminAddSourceRecord: vi.fn(),
  },
}));

import { api } from '../lib/api';
const mockApi = api as unknown as {
  adminGetTitleDetail: ReturnType<typeof vi.fn>; adminGetProvenance: ReturnType<typeof vi.fn>;
  adminUpdateTitle: ReturnType<typeof vi.fn>; adminUpdateSourceRecord: ReturnType<typeof vi.fn>; adminAddSourceRecord: ReturnType<typeof vi.fn>;
};

const TITLE = {
  id: 't1', internalId: 'DEMO0001', titleEn: 'A Film', titleAr: 'فيلم', description: 'old desc',
  releaseYear: 1999, genres: ['Drama'], originalLanguage: 'ar', externalIds: null,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  summary: { hasFingerprint: true, hasV2: true, licenseStatus: 'commercial_allowed', sourceRecords: 1, unreviewedFeatures: 0 },
};

const PROVENANCE = {
  titleId: 't1',
  sourceRecords: [
    { id: 'sr1', titleId: 't1', fieldName: 'description', value: null, source: 'wikipedia', license: null, licenseStatus: 'commercial_allowed', allowsStorage: true, allowsDerivation: true, allowsTraining: false, attributionRequired: true, fallbackPlan: null, reviewStatus: 'human_verified', supersededBy: null, createdAt: '2026-01-01T00:00:00.000Z' },
  ],
  features: [],
  byExtractor: {},
  licenseStatus: 'commercial_allowed',
};

beforeEach(() => {
  vi.clearAllMocks();
  currentParams = new URLSearchParams({ titleId: 't1' });
  mockApi.adminGetTitleDetail.mockResolvedValue(TITLE);
  mockApi.adminGetProvenance.mockResolvedValue(PROVENANCE);
});

// ADMIN-W4 (W0 case A2/A3, ADM-P0-03/04): title fields + rights registry,
// the atomic-write/readback flow, and the 409-on-already-superseded guard.
describe('TitleEditAdmin', () => {
  it('shows a safe message instead of a blank screen when no title is selected', async () => {
    currentParams = new URLSearchParams();
    render(<TitleEditAdmin />);
    expect(screen.getByText(/لا يوجد فيلم محدد/)).toBeInTheDocument();
  });

  it('sends only the field that actually changed', async () => {
    mockApi.adminUpdateTitle.mockResolvedValue({ ...TITLE, releaseYear: 2001 });
    render(<TitleEditAdmin />);
    await waitFor(() => expect(screen.getByDisplayValue('A Film')).toBeInTheDocument());

    const yearInput = screen.getByLabelText('سنة الإصدار');
    await userEvent.clear(yearInput);
    await userEvent.type(yearInput, '2001');
    await userEvent.click(screen.getByRole('button', { name: 'حفظ بيانات الفيلم' }));

    await waitFor(() => expect(mockApi.adminUpdateTitle).toHaveBeenCalledWith('t1', { releaseYear: 2001 }));
  });

  it('adds a new source record', async () => {
    mockApi.adminAddSourceRecord.mockResolvedValue({ ...PROVENANCE.sourceRecords[0], id: 'sr2' });
    render(<TitleEditAdmin />);
    await waitFor(() => expect(screen.getByDisplayValue('A Film')).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText('الحقل المصدر'), 'genres');
    await userEvent.type(screen.getByLabelText('مصدر المعلومة'), 'imdb');
    await userEvent.click(screen.getByRole('button', { name: 'إضافة سجل' }));

    await waitFor(() => expect(mockApi.adminAddSourceRecord).toHaveBeenCalledWith('t1', expect.objectContaining({ fieldName: 'genres', source: 'imdb' })));
  });

  it('shows the already-superseded refusal in plain language on a 409', async () => {
    mockApi.adminUpdateSourceRecord.mockRejectedValue(new MockApiError('Conflict', 409, { reason: 'already_superseded' }));
    render(<TitleEditAdmin />);
    await waitFor(() => expect(screen.getByText('wikipedia')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'تعديل' }));
    // Two "حالة الترخيص" selects now exist -- this row's edit form and the
    // always-present "add a new record" form below it; the edit row's own
    // renders first in document order.
    const licenseSelect = screen.getAllByLabelText('حالة الترخيص')[0];
    await userEvent.selectOptions(licenseSelect, 'non_commercial_only');
    await userEvent.click(screen.getByRole('button', { name: 'حفظ' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('استُبدل بتعديل لاحق');
  });
});
