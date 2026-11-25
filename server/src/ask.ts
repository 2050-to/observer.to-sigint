import { ApiError } from './http.js'
import { isAskDataset } from './personal.js'
import type { Store } from './store.js'

const SYSTEM = [
  'You answer questions about the signed-in account\'s own Observer.to records.',
  'Use only the records in the prompt. If they do not contain the answer, say so.',
  'Do not claim to know about any other account.',
  'Do not provide exploit instructions, interception steps, or ways to access someone else\'s data.',
].join(' ')

export async function askAccount(
  store: Store,
  userId: string,
  body: unknown,
  complete: (question: string, excerpt: string) => Promise<string> = deepseekAnswer,
): Promise<{ answer: string; excerpt: string; id: string; askedAt: string }> {
  if (!body || typeof body !== 'object') throw new ApiError(400, 'question is required')
  const record = body as { dataset?: unknown; question?: unknown }
  if (!isAskDataset(record.dataset)) throw new ApiError(400, 'dataset is invalid')
  const question = typeof record.question === 'string' ? record.question.trim() : ''
  if (!question || question.length > 1000) throw new ApiError(400, 'question is required')
  const subscription = await store.subscriptionFor(userId)
  if (subscription.status !== 'active') throw new ApiError(402, 'subscription required')
  const excerpt = await store.askExcerpt(userId, record.dataset, question)
  const answer = (await complete(question, excerpt)).trim()
  if (!answer) throw new ApiError(502, 'the assistant returned an empty answer')
  return store.rememberQuestion(userId, question, answer.slice(0, 8000), excerpt)
}

export async function deepseekAnswer(question: string, excerpt: string): Promise<string> {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim()
  if (!apiKey) throw new ApiError(503, 'AI is not configured')
  const model = process.env.DEEPSEEK_MODEL?.trim() || 'deepseek-chat'
  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `Question: ${question}\n\nRecords:\n${excerpt}` },
      ],
    }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new ApiError(502, 'the assistant request failed')
  const body = await response.json() as { choices?: { message?: { content?: string } }[] }
  const content = body.choices?.[0]?.message?.content
  if (typeof content !== 'string') throw new ApiError(502, 'the assistant returned an empty answer')
  return content
}
