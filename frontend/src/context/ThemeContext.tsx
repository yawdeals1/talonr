import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

export type ThemeSetting = "system" | "light" | "dark";

const STORAGE_KEY = "talonr_theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

function resolveIsDark(setting: ThemeSetting): boolean {
  if (setting === "dark") return true;
  if (setting === "light") return false;
  return window.matchMedia(DARK_QUERY).matches;
}

function applyTheme(setting: ThemeSetting) {
  document.documentElement.classList.toggle("dark", resolveIsDark(setting));
}

interface ThemeContextValue {
  theme: ThemeSetting;
  setTheme: (theme: ThemeSetting) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeSetting>(
    () => (localStorage.getItem(STORAGE_KEY) as ThemeSetting | null) ?? "system"
  );

  const setTheme = useCallback((next: ThemeSetting) => {
    setThemeState(next);
    if (next === "system") {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, next);
    }
    applyTheme(next);
  }, []);

  // Keep following the OS live while in "system" mode, per SCREENS.md.
  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system") return;

    const mql = window.matchMedia(DARK_QUERY);
    const onChange = () => applyTheme("system");
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [theme]);

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
