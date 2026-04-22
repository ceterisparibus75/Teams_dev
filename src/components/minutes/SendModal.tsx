'use client'
import { useState } from 'react'
import { Modal, Button } from '@/components/ui'

interface Recipient {
  name: string
  email: string
}

interface Props {
  open: boolean
  onClose: () => void
  onConfirm: (recipients: Recipient[]) => Promise<void>
  participants: Recipient[]
  subject: string
}

export function SendModal({ open, onClose, onConfirm, participants, subject }: Props) {
  const [selected, setSelected] = useState<Set<string>>(
    new Set(participants.map((p) => p.email))
  )
  const [confirmed, setConfirmed] = useState(false)
  const [sending, setSending] = useState(false)

  function toggle(email: string) {
    setSelected((prev) => {
      const s = new Set(prev)
      s.has(email) ? s.delete(email) : s.add(email)
      return s
    })
  }

  async function handleSend() {
    setSending(true)
    const recipients = participants.filter((p) => selected.has(p.email))
    await onConfirm(recipients)
    setSending(false)
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="Envoyer le compte rendu">
      <div className="space-y-4">
        <p className="text-sm text-gray-600">
          Objet : <span className="font-medium">Compte rendu — {subject}</span>
        </p>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">
            Destinataires
          </p>
          <div className="space-y-1">
            {participants.map((p) => (
              <label
                key={p.email}
                className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selected.has(p.email)}
                  onChange={() => toggle(p.email)}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                {p.name}{' '}
                <span className="text-gray-400">({p.email})</span>
              </label>
            ))}
          </div>
        </div>

        <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="mt-0.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          J&apos;ai relu et validé ce compte rendu
        </label>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>
            Annuler
          </Button>
          <Button
            onClick={handleSend}
            disabled={!confirmed || selected.size === 0}
            loading={sending}
          >
            Confirmer l&apos;envoi
          </Button>
        </div>
      </div>
    </Modal>
  )
}
