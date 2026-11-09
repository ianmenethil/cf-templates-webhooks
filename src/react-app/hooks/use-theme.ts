import { createContext, useContext } from "react";

/** The panel's colour choices; `system` follows the operating system setting. */
export type Theme = "dark" | "light" | "system";

/** Every theme, in the order the theme toggle cycles through them. */
export const THEMES: readonly Theme[] = ["system", "light", "dark"];

/** What {@link ThemeProvider} shares: the current choice and a way to change and remember it. */
type ThemeProviderState = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
};

/** Context behind {@link useTheme}; `undefined` outside a `ThemeProvider`. */
export const ThemeProviderContext = createContext<
  ThemeProviderState | undefined
>(undefined);

/**
 * Reads the current theme choice and the function that changes it.
 * @returns The theme and `setTheme`; throws when used outside a `ThemeProvider`.
 */
export const useTheme = (): ThemeProviderState => {
  const context = useContext(ThemeProviderContext);

  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }

  return context;
};
