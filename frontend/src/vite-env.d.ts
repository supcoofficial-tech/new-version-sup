/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string
  // می‌تونی کلیدهای دیگه env رو هم همینجا اضافه کنی
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
