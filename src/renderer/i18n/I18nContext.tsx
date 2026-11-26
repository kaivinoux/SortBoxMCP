import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import {
  DEFAULT_LANGUAGE,
  getLocaleForLanguage,
  getMessages,
  normalizeLanguage,
  type AppLanguage,
  type TranslationBundle,
} from "../../shared/i18n.js";

const STORAGE_KEY = "sortbox.language";

interface I18nContextValue {
  lang: AppLanguage;
  locale: string;
  t: TranslationBundle;
  setLang: (next: AppLanguage) => void;
}

const I18nContext = createContext<I18nContextValue>({
  lang: DEFAULT_LANGUAGE,
  locale: getLocaleForLanguage(DEFAULT_LANGUAGE),
  t: getMessages(DEFAULT_LANGUAGE),
  setLang: () => {},
});

function readInitialLanguage(): AppLanguage {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return normalizeLanguage(saved);
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<AppLanguage>(readInitialLanguage);

  const setLang = useCallback((next: AppLanguage) => {
    const normalized = normalizeLanguage(next);
    setLangState(normalized);
    try {
      window.localStorage.setItem(STORAGE_KEY, normalized);
    } catch {
      // Ignore storage errors in restricted environments
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  return (
    <I18nContext.Provider
      value={{
        lang,
        locale: getLocaleForLanguage(lang),
        t: getMessages(lang),
        setLang,
      }}
    >
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}
