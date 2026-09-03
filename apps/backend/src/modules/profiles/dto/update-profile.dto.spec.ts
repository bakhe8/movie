import { describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateProfileDto } from './update-profile.dto';

// class-validator decorators are only exercised by the global ValidationPipe
// at the HTTP boundary -- ProfilesService trusts the DTO was already
// validated, so this is the only place an empty `name` would be caught.
describe('UpdateProfileDto', () => {
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
});
