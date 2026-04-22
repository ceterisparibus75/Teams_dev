import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const existing = await prisma.template.findFirst({ where: { isDefault: true } })
  if (existing) {
    console.log('Template par défaut déjà existant')
    return
  }

  await prisma.template.create({
    data: {
      name: 'Standard BL & Associés',
      isDefault: true,
      sections: [
        { id: 'summary',   label: 'Résumé',               type: 'text',  aiGenerated: true  },
        { id: 'decisions', label: 'Décisions',             type: 'list',  aiGenerated: true  },
        { id: 'actions',   label: 'Actions à suivre',      type: 'table', aiGenerated: true  },
        { id: 'notes',     label: 'Notes complémentaires', type: 'text',  aiGenerated: false },
      ],
      footerHtml: 'SELAS BL & Associés — Administrateurs Judiciaires',
    },
  })
  console.log('✓ Template par défaut créé')
}

main().catch(console.error).finally(() => prisma.$disconnect())
