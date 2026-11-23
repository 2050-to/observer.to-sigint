import assert from 'node:assert/strict'
import Stripe from 'stripe'
import { acceptWebhook, effectFromEvent, startCheckout, type BillingEffect } from './billing.js'
import { ApiError } from './http.js'
import type { Store } from './store.js'

const secret = 'whsec_test_secret'
process.env.STRIPE_SECRET_KEY ??= 'sk_test_observer'
process.env.STRIPE_WEBHOOK_SECRET ??= secret

function event(type: string, object: Record<string, unknown>) {
  return { type, data: { object } }
}

const active = await effectFromEvent(event('customer.subscription.updated', {
  id: 'sub_123',
  customer: 'cus_123',
  status: 'active',
  items: { data: [{ current_period_end: 1_800_000_000 }] },
}), { chargeContext: async () => ({ customerId: null, subscriptionId: null }) })
assert.equal(active?.status, 'active')
assert.equal(active?.customerId, 'cus_123')
assert.equal(active?.subscriptionId, 'sub_123')
assert.equal(active?.currentPeriodEnd?.toISOString(), new Date(1_800_000_000 * 1000).toISOString())

const removed = await effectFromEvent(event('customer.subscription.deleted', {
  id: 'sub_123',
  customer: { id: 'cus_123' },
  status: 'canceled',
}), { chargeContext: async () => ({ customerId: null, subscriptionId: null }) })
assert.equal(removed?.status, 'canceled')
assert.equal(removed?.customerId, 'cus_123')

const paid = await effectFromEvent(event('invoice.paid', {
  customer: 'cus_123',
  parent: { subscription_details: { subscription: 'sub_123' } },
}), { chargeContext: async () => ({ customerId: null, subscriptionId: null }) })
assert.equal(paid?.status, 'active')
assert.equal(paid?.subscriptionId, 'sub_123')

const failed = await effectFromEvent(event('invoice.payment_failed', {
  customer: 'cus_123',
  subscription: 'sub_123',
}), { chargeContext: async () => ({ customerId: null, subscriptionId: null }) })
assert.equal(failed?.status, 'past_due')

const checkout = await effectFromEvent(event('checkout.session.completed', {
  mode: 'subscription',
  payment_status: 'paid',
  customer: 'cus_123',
  subscription: 'sub_123',
}), { chargeContext: async () => ({ customerId: null, subscriptionId: null }) })
assert.equal(checkout?.status, 'active')
assert.equal(checkout?.overrideRisk, true)

const unpaid = await effectFromEvent(event('checkout.session.completed', {
  mode: 'subscription',
  payment_status: 'unpaid',
  customer: 'cus_123',
  subscription: 'sub_123',
}), { chargeContext: async () => ({ customerId: null, subscriptionId: null }) })
assert.equal(unpaid, null)

const refunded = await effectFromEvent(event('charge.refunded', {
  customer: 'cus_123',
}), { chargeContext: async () => ({ customerId: null, subscriptionId: null }) })
assert.equal(refunded?.status, 'refunded')

const disputed = await effectFromEvent(event('charge.dispute.created', {
  charge: 'ch_123',
}), {
  chargeContext: async (chargeId) => {
    assert.equal(chargeId, 'ch_123')
    return { customerId: 'cus_123', subscriptionId: 'sub_123' }
  },
})
assert.equal(disputed?.status, 'disputed')
assert.equal(disputed?.subscriptionId, 'sub_123')

const fraud = await effectFromEvent(event('radar.early_fraud_warning.created', {
  charge: { id: 'ch_999' },
}), {
  chargeContext: async () => ({ customerId: 'cus_123', subscriptionId: 'sub_123' }),
})
assert.equal(fraud?.status, 'fraud_warning')

const payload = JSON.stringify({
  id: 'evt_test',
  object: 'event',
  type: 'customer.subscription.updated',
  data: { object: { id: 'sub_123', object: 'subscription', customer: 'cus_123', status: 'active' } },
})
const header = Stripe.webhooks.generateTestHeaderString({ payload, secret })
const applied: BillingEffect[] = []
const store = {
  applySubscription: async (effect: BillingEffect) => {
    applied.push(effect)
    return true
  },
} as unknown as Store
await acceptWebhook(payload, header, store)
assert.equal(applied.length, 1)
assert.equal(applied[0]?.status, 'active')
assert.equal(applied[0]?.customerId, 'cus_123')

await assert.rejects(
  () => acceptWebhook(payload, `${header}tampered`, store),
  (error: unknown) => error instanceof ApiError && error.status === 400,
)

for (const email of ['ben@2050.to', 'Alicia@2050.to', 'vicanwulika@gmail.com']) {
  await assert.rejects(
    () => startCheckout(store, { id: 'comp', email }),
    (error: unknown) => error instanceof ApiError && error.status === 403,
  )
}

console.log('billing checks passed')
