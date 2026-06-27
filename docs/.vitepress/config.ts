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
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Overview', link: '/guide/overview' },
      { text: 'GitHub', link: 'https://github.com/neutro-web/view' },
    ],
    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Getting Started', link: '/guide/getting-started' },
          { text: 'Overview', link: '/guide/overview' },
        ],
      },
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/neutro-web/view' },
    ],
  },
})
