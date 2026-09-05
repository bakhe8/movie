import { describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateProfileDto } from './update-profile.dto';

// class-validator decorators are only exercised by the global ValidationPipe
// at the HTTP boundary -- ProfilesService trusts the DTO was already
// validated, so this is the only place an empty `name` would be caught.
describe('UpdateProfileDto', () => {
  it.each(['cinema', 'premiere', 'montage', null])('accepts the appearance preference %s', async (preferredAppearance) => {
    expect(await validate(plainToInstance(UpdateProfileDto, { preferredAppearance }))).toHaveLength(0);
  });

  it.each(['dark', 'system', '', 'Cinema', 1, ['cinema']])('rejects invalid appearance %s', async (preferredAppearance) => {
    const errors = await validate(plainToInstance(UpdateProfileDto, { preferredAppearance }));
    expect(errors.some((error) => error.property === 'preferredAppearance')).toBe(true);
  });

  it('rejects an empty name instead of silently blanking the profile out', async () => {
    const dto = plainToInstance(UpdateProfileDto, { name: '' });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'name')).toBe(true);
  });

  it('allows name to be omitted entirely (partial update)', async () => {
    const dto = plainToInstance(UpdateProfileDto, { preferredLanguage: 'en' });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it('accepts a non-empty name', async () => {
    const dto = plainToInstance(UpdateProfileDto, { name: 'New name' });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  // Onboarding fields (blueprint §4.1): a two-letter ISO market and a short
  // list of platform identifiers; both optional, neither a taste input.
  it('accepts an ISO 3166-1 alpha-2 market and a platform list', async () => {
    const dto = plainToInstance(UpdateProfileDto, { market: 'SA', platforms: ['netflix', 'shahid'] });

    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects a market that is not a two-letter upper-case code', async () => {
    for (const market of ['saudi', 'sa', 'SAU', '']) {
      const errors = await validate(plainToInstance(UpdateProfileDto, { market }));
      expect(errors.some((error) => error.property === 'market')).toBe(true);
    }
  });

  it('rejects platforms that are not a bounded list of short strings', async () => {
    const notAnArray = await validate(plainToInstance(UpdateProfileDto, { platforms: 'netflix' }));
    expect(notAnArray.some((error) => error.property === 'platforms')).toBe(true);

    const tooMany = await validate(
      plainToInstance(UpdateProfileDto, { platforms: Array.from({ length: 21 }, (_, index) => `p${index}`) }),
    );
    expect(tooMany.some((error) => error.property === 'platforms')).toBe(true);

    const tooLong = await validate(plainToInstance(UpdateProfileDto, { platforms: ['x'.repeat(41)] }));
    expect(tooLong.some((error) => error.property === 'platforms')).toBe(true);
  });
});
