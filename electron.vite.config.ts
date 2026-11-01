import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

const PROD_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:"

// 生产构建期注入 CSP meta（file:// 下 webRequest 头不生效，终审重要-3）；dev 需内联 HMR preamble 不注入
const prodCsp = {
  name: 'prod-csp',
  transformIndexHtml: {
    order: 'post' as const,
    handler(html: unknown) {
      if (process.env['ELECTRON_RENDERER_URL']) return html
      // Vite transformIndexHtml 对象钩子返回 HtmlTagDescriptor[]
      return [{
        tag: 'meta',
        injectTo: 'head-prepend' as const,
        attrs: { 'http-equiv': 'Content-Security-Policy', content: PROD_CSP }
      }]
    }
  }
}

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': resolve('src/shared') } }
  },
  preload: {
    resolve: { alias: { '@shared': resolve('src/shared') } }
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react(), tailwindcss(), prodCsp]
  }
})
