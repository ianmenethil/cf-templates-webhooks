import { type ReactNode, useLayoutEffect, useState } from "react";
import {
  THEMES,
  type Theme,
  ThemeProviderContext,
} from "@/hooks/use-theme";

/** The `localStorage` key that remembers the choice. */
const STORAGE_KEY = "webhooks-theme";

/** Props for {@link ThemeProvider}. */
type ThemeProviderProps = {
  children: ReactNode;
};

/**
 * Reads the saved theme choice; storage can be unavailable in private windows.
 * @returns The saved theme, or `system` when nothing valid is saved or storage cannot be read.
 */
const readTheme = (): Theme => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return THEMES.find((theme) => theme === saved) ?? "system";
  } catch {
    return "system";
  }
};

/**
 * Puts the chosen theme on `<html>` as a `light` or `dark` class (shadcn's dark mode for Vite)
 * and remembers the choice. `system` follows the operating system and changes with it.
 */
export const ThemeProvider = ({ children }: ThemeProviderProps) => {
  const [theme, setTheme] = useState<Theme>(readTheme);

  // A layout effect, so the class is on `<html>` before the first paint.
  useLayoutEffect(() => {
    const root = window.document.documentElement;
    const dark = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      root.classList.remove("light", "dark");
      root.classList.add(
        theme === "system" ? (dark.matches ? "dark" : "light") : theme,
      );
    };

    apply();
    if (theme !== "system") {
      return;
    }
    dark.addEventListener("change", apply);
    return () => dark.removeEventListener("change", apply);
  }, [theme]);

  const value = {
    theme,
    setTheme: (next: Theme) => {
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // Nothing to do: the choice is only remembered for this visit.
      }
      setTheme(next);
    },
  };

  return (
    <ThemeProviderContext.Provider value={value}>
      {children}
    </ThemeProviderContext.Provider>
  );
};
