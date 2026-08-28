import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import react from "@vitejs/plugin-react-swc"
import { defineConfig, loadEnv } from "vite"
import tsconfigPaths from "vite-tsconfig-paths"

const backgroundOf = (selector: string): string => {
  const tokens = readFileSync("src/styles/tokens.css", "utf8")
  const found = /--bg:\s*(#[0-9a-f]{3,8})/i.exec(tokens.slice(tokens.indexOf(selector)))
  if (!found) throw new Error(`no --bg under ${selector}`)
  return found[1]
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
      proxy: proxyOf(backendTarget, catalogTarget, toncenterTarget),
    },
    preview: {
      proxy: proxyOf(backendTarget, catalogTarget, toncenterTarget),
    },
  }
})
