import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { DatabaseConfig } from '../config/database.config';
import { AuditLog } from '../entities/audit-log.entity';
import { User } from '../entities/user.entity';
import { normalizeEmail } from '../modules/auth/email';

// Grants (or, with --revoke, removes) the admin role for one account by
// email. Deliberately a command on the server, not an HTTP route: the first
// admin has to come from somewhere, and an admin promoting another account
// is done through PATCH /admin/users/:id (audited with the actor). This
// path is audited with actorRole 'operator' and no actor id.
//
//   npm run admin:grant -- someone@example.com
//   npm run admin:grant -- someone@example.com --revoke
async function main() {
  const [typed, flag] = process.argv.slice(2);
  const email = normalizeEmail(typed) as string | undefined;
  if (!email) {
    console.error('usage: grant-admin <email> [--revoke]');
    process.exit(2);
  }
  const revoke = flag === '--revoke';
  const dataSource = new DataSource(DatabaseConfig() as never);
  await dataSource.initialize();
  try {
    const users = dataSource.getRepository(User);
    const user = await users.findOne({ where: { email } });
    if (!user) {
      console.error(`no account with email ${email}`);
      process.exit(1);
    }
    const role = revoke ? 'user' : 'admin';
    if (user.role === role) {
      console.log(`${email} already has role ${role}`);
      return;
    }
    user.role = role;
    await users.save(user);
    await dataSource.getRepository(AuditLog).save(
      dataSource.getRepository(AuditLog).create({
        actorUserId: null,
        actorRole: 'operator',
        action: 'admin.user.update',
        resource: 'user',
        resourceId: user.id,
        status: 'ok',
        reason: `role=${role} via grant-admin script`,
        ipHash: null,
      }),
    );
    console.log(`${email}: role is now ${role}`);
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
