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
      isActive: true,
      enteteTexteLignes: ['SELAS BL & Associés', 'Administrateurs Judiciaires'],
      enteteAlignement: 'droite',
      piedPageLignes: ['SELAS BL & Associés — Administrateurs Judiciaires et Mandataires'],
      piedPageAlignement: 'centre',
      numeroterPages: true,
      couleurTitres: '70989C',
      couleurEnteteCabinet: '70989C',
      couleurEnteteTableau: 'E8F0F1',
      couleurBordureTableau: 'D0E4E5',
    },
  })
  console.log('✓ Template par défaut créé')
}

main().catch(console.error).finally(() => prisma.$disconnect())
