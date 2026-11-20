import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { Server } from "node:http"
import { createRequire } from "node:module"
import react from "@vitejs/plugin-react-swc"
import { defineConfig, loadEnv, searchForWorkspaceRoot } from "vite"
import tsconfigPaths from "vite-tsconfig-paths"

const uiSrc = process.env.UI_SRC

const blockOf = (tokens: string, selector: string): string => {
  const start = tokens.indexOf(selector)
  return start < 0 ? "" : tokens.slice(start, tokens.indexOf("}", start))
}

const valueIn = (block: string, name: string): string | undefined =>
  new RegExp(`(?<![\\w-])${name}:\\s*([^;]+);`).exec(block)?.[1].trim()

const backgroundOf = (selector: string): string => {
  const path = uiSrc ? `${uiSrc}/src/styles/tokens.css` : createRequire(import.meta.url).resolve("@myton/ui/tokens.css")
  const tokens = readFileSync(path, "utf8")
  const own = blockOf(tokens, selector)
  const root = blockOf(tokens, ":root {")
  let name = "--bg"
  for (let step = 0; step < 8; step += 1) {
    const value = valueIn(own, name) ?? valueIn(root, name)
    if (value === undefined) break
    if (/^#[0-9a-f]{3,8}$/i.test(value)) return value
    const next = /^var\((--[\w-]+)\)$/.exec(value)
    if (!next) break
    name = next[1]
  }
  throw new Error(`no hex --bg under ${selector}`)
}

const proxyOf = (backendTarget: string, catalogTarget: string, toncenterTarget: string) => ({
  "/api": {
    target: backendTarget,
    changeOrigin: true,
    cookieDomainRewrite: "",
  },
  "/mtpo": {
    target: catalogTarget,
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/mtpo/, ""),
  },
  "/toncenter": {
    target: toncenterTarget,
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/toncenter/, ""),
  },
})

const manifestOf = (siteUrl: string): string =>
  JSON.stringify(
    {
      url: siteUrl,
      name: "My TON Storage",
      iconUrl: `${siteUrl}/icon.png`,
    },
    null,
    2,
  )

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "")
  const siteUrl = env.VITE_SITE_URL || "https://mytonstorage.org"
  const backendTarget = env.BACKEND_PROXY_TARGET || "https://mytonstorage.org"
  const catalogTarget = env.CATALOG_PROXY_TARGET || "https://mytonprovider.org"
  const toncenterTarget = env.TONCENTER_PROXY_TARGET || "https://toncenter.com"
  let base = "/"

  return {
    resolve: {
      alias: uiSrc
        ? [
            { find: /^@myton\/ui$/, replacement: `${uiSrc}/src/index.ts` },
            { find: /^@myton\/ui\/domain$/, replacement: `${uiSrc}/src/domain/index.ts` },
            { find: /^@myton\/ui\/locale$/, replacement: `${uiSrc}/src/locale/index.ts` },
            { find: /^@myton\/ui\/styles\.css$/, replacement: `${uiSrc}/src/styles/index.css` },
            { find: /^@myton\/ui\/site\.css$/, replacement: `${uiSrc}/src/styles/site.css` },
            { find: /^@myton\/ui\/fonts\.css$/, replacement: `${uiSrc}/src/styles/fonts.css` },
            { find: /^@myton\/ui\/i18n$/, replacement: `${uiSrc}/src/i18n/index.ts` },
            { find: /^@myton\/ui\/text\.module\.css$/, replacement: `${uiSrc}/src/styles/text.module.css` },
            { find: /^@myton\/ui\/motion\.module\.css$/, replacement: `${uiSrc}/src/styles/motion.module.css` },
          ]
        : [],
      dedupe: ["react", "react-dom", "i18next", "react-i18next"],
    },
    plugins: [
      react(),
      tsconfigPaths(),
      {
        name: "index-values",
        transformIndexHtml: (html) =>
          html
            .replaceAll("%SITE_URL%", siteUrl)
            .replaceAll("%BG_LIGHT%", backgroundOf(":root {"))
            .replaceAll("%BG_DARK%", backgroundOf('[data-theme="dark"] {')),
      },
      {
        name: "upload-request-timeout",
        configureServer: (server) => {
          if (server.httpServer instanceof Server) server.httpServer.requestTimeout = 0
        },
      },
      {
        name: "tonconnect-manifest",
        configureServer: (server) => {
          server.middlewares.use((req, res, next) => {
            if (req.url?.split("?")[0] !== "/tonconnect-manifest.json") return next()
            res.setHeader("Content-Type", "application/json")
            res.end(manifestOf(siteUrl))
          })
        },
        generateBundle() {
          this.emitFile({ type: "asset", fileName: "tonconnect-manifest.json", source: manifestOf(siteUrl) })
        },
      },
      {
        name: "preload-fonts",
        enforce: "post",
        configResolved: (config) => {
          base = config.base
        },
        transformIndexHtml: (html, ctx) => ({
          html,
          tags: Object.keys(ctx.bundle ?? {})
            .filter((file) => /inter-(latin|cyrillic)-wght-normal-[^.]+\.woff2$/.test(file))
            .map((file) => ({
              tag: "link",
              attrs: { rel: "preload", as: "font", type: "font/woff2", crossorigin: "", href: `${base}${file}` },
              injectTo: "head-prepend" as const,
            })),
        }),
      },
    ],
    css: {
      modules: {
        generateScopedName: (name, filename) => {
          const file = filename.split("/").pop()?.replace(".module.css", "") ?? "styles"
          const hash = createHash("sha256").update(`${filename}:${name}`).digest("base64url").slice(0, 5)
          return `${file}_${name}__${hash}`
        },
      },
    },
    server: {
      host: true,
      fs: { allow: [searchForWorkspaceRoot(process.cwd()), ...(uiSrc ? [uiSrc] : [])] },
      proxy: proxyOf(backendTarget, catalogTarget, toncenterTarget),
    },
    preview: {
      proxy: proxyOf(backendTarget, catalogTarget, toncenterTarget),
    },
  }
})
