import { describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LoginDto } from './dto/login.dto';
import { RequestPasswordResetDto } from './dto/password-reset.dto';
import { RegisterDto } from './dto/register.dto';
import { normalizeEmail } from './email';

// The three doors an address walks through, transformed the way the global
// ValidationPipe does it (transform: true -> plainToInstance, then validate).
describe('email normalization', () => {
  it('trims and lower-cases strings, leaves anything else to validation', () => {
    expect(normalizeEmail('  Name@Example.COM ')).toBe('name@example.com');
    expect(normalizeEmail(42)).toBe(42);
    expect(normalizeEmail(undefined)).toBeUndefined();
  });

  it('folds the address on register, login and reset before validation', async () => {
    const register = plainToInstance(RegisterDto, {
      email: ' Bakheet@Gmail.com',
      password: 'CorrectHorseBattery1',
      firstName: 'B',
      lastName: 'K',
    });
    const login = plainToInstance(LoginDto, { email: 'BAKHEET@GMAIL.COM ', password: 'CorrectHorseBattery1' });
    const reset = plainToInstance(RequestPasswordResetDto, { email: 'Bakheet@gmail.com' });

    expect(register.email).toBe('bakheet@gmail.com');
    expect(login.email).toBe('bakheet@gmail.com');
    expect(reset.email).toBe('bakheet@gmail.com');
    expect(await validate(register)).toHaveLength(0);
    expect(await validate(login)).toHaveLength(0);
    expect(await validate(reset)).toHaveLength(0);
  });

  it('still rejects what is not an address', async () => {
    const reset = plainToInstance(RequestPasswordResetDto, { email: '  not-an-email ' });
    expect(reset.email).toBe('not-an-email');
    expect(await validate(reset)).not.toHaveLength(0);
  });
});
