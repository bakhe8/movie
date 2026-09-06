import { IsNull, Not } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';
import { PUBLISHED_TITLE_WHERE, wherePublished } from './publication-guard';

// Direct tests of the guard logic itself, against a mock repository/
// queryBuilder only -- no consumer imports this yet (see the file's own
// header comment: wiring waits for board 1D-9). These exist so the logic
// is proven correct in isolation before that gate ever connects it.
describe('publication-guard (not yet consumed by any service)', () => {
  describe('PUBLISHED_TITLE_WHERE', () => {
    it('is the same condition Repository.find()/findOne() would need: publishedRevisionId is not null', () => {
      expect(PUBLISHED_TITLE_WHERE).toEqual({ publishedRevisionId: Not(IsNull()) });
    });

    it('composes into a where object without overwriting other keys', () => {
      const where = { id: 't-1', ...PUBLISHED_TITLE_WHERE };
      expect(where).toEqual({ id: 't-1', publishedRevisionId: Not(IsNull()) });
    });
  });

  describe('wherePublished', () => {
    function queryBuilderMock() {
      return { andWhere: vi.fn().mockReturnThis() };
    }

    it('adds an IS NOT NULL condition on publishedRevisionId, qualified by the given alias', () => {
      const qb = queryBuilderMock();

      wherePublished(qb as never, 'title');

      expect(qb.andWhere).toHaveBeenCalledTimes(1);
      expect(qb.andWhere).toHaveBeenCalledWith('title."publishedRevisionId" IS NOT NULL');
    });

    it('uses whatever alias the caller passed, never a hardcoded one', () => {
      const qb = queryBuilderMock();

      wherePublished(qb as never, 'recommendationTitle');

      expect(qb.andWhere).toHaveBeenCalledWith('recommendationTitle."publishedRevisionId" IS NOT NULL');
    });

    it('returns the same builder so it composes into an existing chain', () => {
      const qb = queryBuilderMock();

      const result = wherePublished(qb as never, 'title');

      expect(result).toBe(qb);
    });
  });
});
