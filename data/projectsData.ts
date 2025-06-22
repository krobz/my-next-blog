interface Project {
  title: string
  description: string
  href?: string
  imgSrc?: string
}

const projectsData: Project[] = [
  {
    title: 'A 3D garment fitting system (Size guide in VIPSHOP)',
    description: `A 3D garment fitting platform for VIPSHOP that analyzes purchase history to create virtual try-on models, reducing returns by providing accurate sizing.`,
    imgSrc: '/static/images/3D_garment_system.png',
    href: 'https://github.com/krobz/3d-garment-fitting-docs',
  },
  // {
  //   title: 'The Time Machine',
  //   description: `Imagine being able to travel back in time or to the future. Simple turn the knob
  //   to the desired date and press "Go". No more worrying about lost keys or
  //   forgotten headphones with this simple yet affordable solution.`,
  //   imgSrc: '/static/images/time-machine.jpg',
  //   href: '/blog/the-time-machine',
  // },
]

export default projectsData
