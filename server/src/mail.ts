export async function sendEmail(input: { to: string; subject: string; text: string }): Promise<'sent' | 'logged'> {
  const key = process.env.RESEND_API_KEY?.trim()
  if (!key) {
    console.log(`Observer.to email (no RESEND_API_KEY)\nTo: ${input.to}\nSubject: ${input.subject}\n${input.text}`)
    return 'logged'
  }
  const from = process.env.EMAIL_FROM?.trim()
  if (!from) throw new Error('EMAIL_FROM is required')
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [input.to],
      subject: input.subject,
      text: input.text,
    }),
  })
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500)
    throw new Error(`email failed (${response.status}) ${detail}`)
  }
  return 'sent'
}
