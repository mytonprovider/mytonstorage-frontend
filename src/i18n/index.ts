import i18n from "i18next"
import { initReactI18next } from "react-i18next"
import { LANGUAGE_KEY, readStored, writeStored } from "@/lib/local-storage"
import en from "./en.json"
import ru from "./ru.json"

const FALLBACK = "en"
const SUPPORTED = [FALLBACK, "ru"]

const preferredLanguage = (): string => {
  const stored = readStored(LANGUAGE_KEY)
  if (stored && SUPPORTED.includes(stored)) return stored

  const browser = navigator.language.split("-")[0]
  return SUPPORTED.includes(browser) ? browser : FALLBACK
}

export const initI18n = (): void => {
  void i18n.use(initReactI18next).init({
    resources: { en: { translation: en }, ru: { translation: ru } },
    lng: preferredLanguage(),
    fallbackLng: FALLBACK,
    interpolation: { escapeValue: false },
  })

  document.documentElement.lang = i18n.language
  i18n.on("languageChanged", (language) => {
    document.documentElement.lang = language
    writeStored(LANGUAGE_KEY, language)
  })
}
