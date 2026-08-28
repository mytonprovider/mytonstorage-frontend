/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string
  readonly VITE_MTPO_URL?: string
  readonly VITE_TONCENTER_URL?: string
  readonly VITE_SITE_URL?: string
  readonly VITE_TONCONNECT_MANIFEST_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module "*.svg" {
  const src: string
  export default src
}
