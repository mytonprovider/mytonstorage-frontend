import { siteI18n } from "@myton/ui/i18n"
import { LANGUAGE_KEY } from "@/lib/local-storage"
import en from "./en.json"
import ru from "./ru.json"

export const { init: initI18n, choose: chooseLanguage } = siteI18n({ en, ru }, LANGUAGE_KEY)
