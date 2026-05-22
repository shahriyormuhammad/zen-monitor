#!/usr/bin/env node

import process from 'node:process';

import dotenv from 'dotenv';
import postgres from 'postgres';

dotenv.config();

const ADMIN_TENANT_SENTINEL = '00000000-0000-0000-0000-000000000000';
const VALID_ROLES = new Set(['owner', 'finance', 'support', 'ops', 'readonly']);

const [target, requestedRole = 'owner'] = process.argv.slice(2);

function usage() {
  console.error('Usage: npm run admin:grant -- <local-user-id-or-email> [owner|finance|support|ops|readonly]');
}

if (!target) {
  usage();
  process.exit(1);
}

if (!VALID_ROLES.has(requestedRole)) {
  console.error(`[admin:grant] invalid role: ${requestedRole}`);
  usage();
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error('[admin:grant] DATABASE_URL is not set');
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} });

try {
  await sql`SELECT set_config('app.tenant_id', ${ADMIN_TENANT_SENTINEL}, false)`;

  const [user] = await sql`
    SELECT id, email
    FROM users
    WHERE id::text = ${target} OR lower(email) = lower(${target})
    LIMIT 1
  `;

  if (!user) {
    console.error('[admin:grant] local user profile not found. Sign in once first, then rerun this command.');
    process.exit(1);
  }

  const [admin] = await sql`
    INSERT INTO platform_admins (user_id, role, status)
    VALUES (${user.id}, ${requestedRole}, 'active')
    ON CONFLICT (user_id)
    DO UPDATE SET role = EXCLUDED.role, status = 'active'
    RETURNING id, user_id, role, status
  `;

  console.log(`[admin:grant] granted ${admin.role} to ${user.email ?? user.id}`);
} finally {
  await sql.end({ timeout: 5 });
}

