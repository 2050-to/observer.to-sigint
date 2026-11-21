import { randomInt } from 'node:crypto'
import Stripe from 'stripe'
import { appOrigin } from './auth.js'
import { ApiError } from './http.js'
import type { Store } from './store.js'

const API_VERSION = '2026-09-30.endive'

export interface BillingEffect {
  customerId: string
  subscriptionId: string | null
  status: string
  currentPeriodEnd: Date | null
  overrideRisk?: boolean
}

export interface ChargeContext {
  customerId: string | null
  subscriptionId: string | null
}

export interface ChargeLookup {
  chargeContext(chargeId: string): Promise<ChargeContext>
}

let client: Stripe | null = null

export function stripeClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY?.trim()
  if (!key) return null
  if (!client) client = new Stripe(key, { apiVersion: API_VERSION })
  return client
}

function requireStripe(): Stripe {
  const stripe = stripeClient()
  if (!stripe || !process.env.STRIPE_PRICE_ID?.trim()) throw new ApiError(503, 'billing is not configured')
  return stripe
}

function idOf(value: unknown): string | null {
  if (typeof value === 'string' && value) return value
  if (value && typeof value === 'object' && 'id' in value && typeof value.id === 'string') return value.id
  return null
}

function periodEnd(value: unknown): Date | null {
  if (!value || typeof value !== 'object') return null
  const record = value as {
    current_period_end?: unknown
    items?: { data?: { current_period_end?: unknown }[] }
  }
  const direct = record.current_period_end
  if (typeof direct === 'number') return new Date(direct * 1000)
  const itemEnd = record.items?.data?.[0]?.current_period_end
  if (typeof itemEnd === 'number') return new Date(itemEnd * 1000)
  return null
}

function invoiceSubscriptionId(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const invoice = value as {
    subscription?: unknown
    parent?: { subscription_details?: { subscription?: unknown } | null } | null
  }
  return idOf(invoice.subscription) ?? idOf(invoice.parent?.subscription_details?.subscription)
}

function letters(length: number): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz'
  return Array.from({ length }, () => alphabet[randomInt(alphabet.length)]).join('')
}

export async function effectFromEvent(
  event: { type: string; data: { object: unknown } },
  lookup: ChargeLookup,
): Promise<BillingEffect | null> {
  const object = event.data.object
  if (!object || typeof object !== 'object') return null
  const record = object as Record<string, unknown>
  if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
    const customerId = idOf(record.customer)
    if (!customerId) return null
    return {
      customerId,
      subscriptionId: typeof record.id === 'string' ? record.id : null,
      status: event.type === 'customer.subscription.deleted' ? 'canceled' : String(record.status ?? 'canceled'),
      currentPeriodEnd: periodEnd(record),
    }
  }
  if (event.type === 'invoice.paid' || event.type === 'invoice.payment_failed') {
    const customerId = idOf(record.customer)
    if (!customerId) return null
    return {
      customerId,
      subscriptionId: invoiceSubscriptionId(record),
      status: event.type === 'invoice.paid' ? 'active' : 'past_due',
      currentPeriodEnd: null,
    }
  }
  if (event.type === 'checkout.session.completed') {
    if (record.mode !== 'subscription') return null
    if (record.payment_status !== 'paid' && record.payment_status !== 'no_payment_required') return null
    const customerId = idOf(record.customer)
    if (!customerId) return null
    return {
      customerId,
      subscriptionId: idOf(record.subscription),
      status: 'active',
      currentPeriodEnd: null,
      overrideRisk: true,
    }
  }
  if (event.type === 'charge.refunded') {
    const customerId = idOf(record.customer)
    if (!customerId) return null
    return { customerId, subscriptionId: null, status: 'refunded', currentPeriodEnd: null }
  }
  if (event.type === 'charge.dispute.created' || event.type === 'radar.early_fraud_warning.created') {
    const chargeId = idOf(record.charge)
    if (!chargeId) return null
    const charge = await lookup.chargeContext(chargeId)
    if (!charge.customerId) return null
    return {
      customerId: charge.customerId,
      subscriptionId: charge.subscriptionId,
      status: event.type === 'charge.dispute.created' ? 'disputed' : 'fraud_warning',
      currentPeriodEnd: null,
    }
  }
  return null
}

async function chargeContext(stripe: Stripe, chargeId: string): Promise<ChargeContext> {
  const charge = await stripe.charges.retrieve(chargeId)
  const customerId = idOf(charge.customer)
  if (!customerId) return { customerId: null, subscriptionId: null }
  const subscriptions = await stripe.subscriptions.list({ customer: customerId, limit: 1 })
  return { customerId, subscriptionId: subscriptions.data[0]?.id ?? null }
}

export async function acceptWebhook(raw: string, signature: string | undefined, store: Store): Promise<void> {
  const stripe = stripeClient()
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim()
  if (!stripe || !secret) throw new ApiError(503, 'billing is not configured')
  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(raw, signature ?? '', secret)
  } catch {
    throw new ApiError(400, 'invalid webhook signature')
  }
  const effect = await effectFromEvent(event, {
    chargeContext: (chargeId) => chargeContext(stripe, chargeId),
  })
  if (effect) await store.applySubscription(effect)
}

export async function startCheckout(store: Store, user: { id: string; email: string }): Promise<string> {
  const stripe = requireStripe()
  const price = process.env.STRIPE_PRICE_ID?.trim() ?? ''
  const existing = await store.subscriptionFor(user.id)
  let customerId = existing.stripeCustomerId
  if (!customerId) {
    const customer = await stripe.customers.create({ email: user.email })
    customerId = customer.id
    await store.saveStripeCustomer(user.id, customerId)
  }
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price, quantity: 1 }],
    success_url: `${appOrigin()}/app?billing=success`,
    cancel_url: `${appOrigin()}/app?billing=cancel`,
    integration_identifier: `observer_alerts_${letters(8)}`,
  })
  if (!session.url) throw new ApiError(502, 'checkout did not return a url')
  return session.url
}

export async function startPortal(store: Store, userId: string): Promise<string> {
  const stripe = requireStripe()
  const existing = await store.subscriptionFor(userId)
  if (!existing.stripeCustomerId) throw new ApiError(409, 'no subscription to manage')
  const session = await stripe.billingPortal.sessions.create({
    customer: existing.stripeCustomerId,
    return_url: `${appOrigin()}/app`,
  })
  return session.url
}
