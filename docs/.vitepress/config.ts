import { defineConfig } from 'vitepress'

export default defineConfig({
  srcExclude: [
    'decision-log-archive.md',
    'decision-log.md',
    'implementation-state.md',
    'reactive-core-contract.md',
    'template-ir.md',
    'design/**',
    'gates/**',
    'superpowers/**',
  ],
  title: '@neutro/view',
  description: 'High-performance, framework-portable, fine-grained reactive view engine.',
  base: '/view/',
  themeConfig: {
    search: {
      provider: 'local',
    },
    nav: [
      { text: 'Getting Started', link: '/guide/getting-started' },
      { text: 'API Reference', link: '/guide/api-reference' },
    ],
    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Overview', link: '/guide/overview' },
          { text: 'Getting Started', link: '/guide/getting-started' },
          { text: 'Authoring .nv', link: '/guide/authoring-nv' },
          { text: 'Reactivity', link: '/guide/reactivity' },
          { text: 'Rendering', link: '/guide/rendering' },
          { text: 'API Reference', link: '/guide/api-reference' },
          { text: 'Architecture', link: '/guide/architecture' },
        ],
      },
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/neutro-web/view' },
    ],
  },
})
