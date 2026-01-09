interface Project {
  title: string
  description: string
  href?: string
  imgSrc?: string
}

const projectsData: Project[] = [
  {
    title: 'TRPGHub - TRPG Session Management tool',
    description: `A mobile app connecting tabletop RPG game masters with players. Features service discovery, one-tap booking, split payments via QR codes, and real-time chat for session coordination.`,
    imgSrc: '/static/images/trpghub.png',
    href: 'https://www.trpghub.com/',
  },
  {
    title: 'A 3D garment fitting system (Size guide in VIPSHOP)',
    description: `A 3D garment fitting platform for VIPSHOP that analyzes purchase history to create virtual try-on models, reducing returns by providing accurate sizing.`,
    imgSrc: '/static/images/3D_garment_system.png',
    href: 'https://github.com/krobz/3d-garment-fitting-docs',
  },
]

export default projectsData
