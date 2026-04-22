import { getValidAccessToken } from '@/lib/microsoft-graph'
import { Client } from '@microsoft/microsoft-graph-client'
import type { MinutesContent } from '@/types'

export interface SendMinutesParams {
  userId: string
  subject: string
  recipients: Array<{ name: string; email: string }>
  content: MinutesContent
  docxBuffer: Buffer
  docxFilename: string
}

function buildHtmlBody(subject: string, content: MinutesContent): string {
  const decisionsHtml = content.decisions.length
    ? `<ul>${content.decisions.map((d) => `<li>${d}</li>`).join('')}</ul>`
    : '<p><em>Aucune décision enregistrée.</em></p>'

  const actionsHtml = content.actions.length
    ? `<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%">
        <tr style="background:#E5E7EB"><th>Description</th><th>Responsable</th><th>Échéance</th></tr>
        ${content.actions
          .map((a) => `<tr><td>${a.description}</td><td>${a.responsable}</td><td>${a.echeance}</td></tr>`)
          .join('')}
       </table>`
    : '<p><em>Aucune action à suivre.</em></p>'

  return `
    <div style="font-family:Arial,sans-serif;max-width:700px">
      <h2 style="color:#1F2937">Compte rendu — ${subject}</h2>
      <p>${content.summary}</p>
      <h3>Décisions</h3>${decisionsHtml}
      <h3>Actions à suivre</h3>${actionsHtml}
      ${content.notes ? `<h3>Notes complémentaires</h3><p>${content.notes}</p>` : ''}
      <hr/>
      <p style="color:#6B7280;font-size:12px">SELAS BL & Associés — Administrateurs Judiciaires</p>
    </div>`
}

export async function sendMinutesEmail(params: SendMinutesParams): Promise<boolean> {
  const { userId, subject, recipients, content, docxBuffer, docxFilename } = params
  const token = await getValidAccessToken(userId)
  if (!token) return false

  const client = Client.init({ authProvider: (done) => done(null, token) })

  const message = {
    subject: `Compte rendu — ${subject}`,
    body: { contentType: 'HTML', content: buildHtmlBody(subject, content) },
    toRecipients: recipients.map((r) => ({
      emailAddress: { name: r.name, address: r.email },
    })),
    attachments: [
      {
        '@odata.type': '#microsoft.graph.fileAttachment',
        name: docxFilename,
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        contentBytes: docxBuffer.toString('base64'),
      },
    ],
  }

  try {
    await client.api('/me/sendMail').post({ message, saveToSentItems: true })
    return true
  } catch (error) {
    console.error('[Email Sender] Failed:', error)
    return false
  }
}
