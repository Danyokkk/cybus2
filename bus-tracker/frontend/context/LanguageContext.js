"use client";

import { createContext, startTransition, useContext, useEffect, useMemo, useState } from "react";
import { languageOptions, translations } from "../utils/translations";

const STORAGE_KEY = "cybus-language";
const LanguageContext = createContext(null);

export function LanguageProvider({ children }) {
  const [language, setLanguageState] = useState("en");

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved && translations[saved]) {
      setLanguageState(saved);
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
    window.localStorage.setItem(STORAGE_KEY, language);
  }, [language]);

  const setLanguage = (nextLanguage) => {
    if (!translations[nextLanguage]) {
      return;
    }
    startTransition(() => {
      setLanguageState(nextLanguage);
    });
  };

  const value = useMemo(
    () => ({
      language,
      setLanguage,
      languages: languageOptions,
      t: translations[language] || translations.en,
    }),
    [language]
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const value = useContext(LanguageContext);
  if (!value) {
    throw new Error("useLanguage must be used inside LanguageProvider.");
  }
  return value;
}
