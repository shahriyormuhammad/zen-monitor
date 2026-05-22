#!/usr/bin/env node

import process from 'node:process';

import dotenv from 'dotenv';
import postgres from 'postgres';

dotenv.config();

if (!process.env.DATABASE_URL) {
  console.error('[billing:seed-plans] DATABASE_URL is not set');
  process.exit(1);
}

const plans = [
  {
    code: 'solo',
    name: 'Solo',
    priceRub: '0',
    billingPeriod: 'month',
    maxTenants: 1,
    maxUsers: 1,
    features: {
      overview: true,
      costs: true,
      economics: true,
      advertising: true,
      reviewsQa: false,
      teamWorkflow: false,
      redistribution: false,
      automation: false,
    },
  },
  {
    code: 'growth',
    name: 'Growth',
    priceRub: '0',
    billingPeriod: 'month',
    maxTenants: 3,
    maxUsers: 3,
    features: {
      overview: true,
      costs: true,
      economics: true,
      advertising: true,
      reviewsQa: true,
      teamWorkflow: false,
      redistribution: false,
      automation: false,
    },
  },
  {
    code: 'team',
    name: 'Team',
    priceRub: '0',
    billingPeriod: 'month',
    maxTenants: 5,
    maxUsers: 10,
    features: {
      overview: true,
      costs: true,
      economics: true,
      advertising: true,
      reviewsQa: true,
      teamWorkflow: true,
      redistribution: false,
      automation: true,
    },
  },
  {
    code: 'ops',
    name: 'Ops',
    priceRub: '0',
    billingPeriod: 'month',
    maxTenants: null,
    maxUsers: null,
    features: {
      overview: true,
      costs: true,
      economics: true,
      advertising: true,
      reviewsQa: true,
      teamWorkflow: true,
      redistribution: true,
      automation: true,
    },
  },
];

const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} });

try {
  for (const plan of plans) {
    await sql`
      INSERT INTO plans (
        code,
        name,
        price_rub,
        billing_period,
        max_tenants,
        max_users,
        features,
        is_active
      )
      VALUES (
        ${plan.code},
        ${plan.name},
        ${plan.priceRub},
        ${plan.billingPeriod},
        ${plan.maxTenants},
        ${plan.maxUsers},
        ${sql.json(plan.features)},
        true
      )
      ON CONFLICT (code)
      DO UPDATE SET
        name = EXCLUDED.name,
        price_rub = EXCLUDED.price_rub,
        billing_period = EXCLUDED.billing_period,
        max_tenants = EXCLUDED.max_tenants,
        max_users = EXCLUDED.max_users,
        features = EXCLUDED.features,
        is_active = true
    `;
  }

  console.log(`[billing:seed-plans] seeded ${plans.length} plans`);
} finally {
  await sql.end({ timeout: 5 });
}

