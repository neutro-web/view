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
    'guide/**',
  ],
  title: '@neutro/view',
  description: 'Fine-grained reactive view engine for the web.',
  base: '/view/',
  themeConfig: {
    search: {
      provider: 'local',
    },
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Getting Started', link: '/getting-started' },
      { text: 'API', link: '/api/' },
      { text: 'Guides', link: '/guides/' },
      { text: 'Community', link: '/community' },
      { text: 'Contributing', link: '/contributing' },
    ],
    sidebar: {
      '/api/': [
        {
          text: 'API Reference',
          items: [
            { text: 'Overview', link: '/api/' },
            { text: 'Core', link: '/api/core' },
            { text: 'Renderer', link: '/api/renderer' },
            { text: 'Plugin & Runtime', link: '/api/plugin' },
          ],
        },
      ],
      '/guides/': [
        {
          text: 'Guides',
          items: [
            { text: 'Overview', link: '/guides/' },
            { text: 'Authoring .nv', link: '/guides/authoring-nv' },
            { text: 'Reactivity', link: '/guides/reactivity' },
            { text: 'Rendering', link: '/guides/rendering' },
            { text: 'Architecture', link: '/guides/architecture' },
          ],
        },
      ],
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/neutro-web/view' },
    ],
  },
})
