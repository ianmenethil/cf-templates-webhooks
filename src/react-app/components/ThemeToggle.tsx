import { Monitor, Moon, Sun } from "lucide-react";
import { THEMES, useTheme } from "@/hooks/use-theme";
import { IconButton } from "./IconButton";

const ICONS = {
  system: <Monitor />,
  light: <Sun />,
  dark: <Moon />,
};

/** Cycles the panel between following the system, light and dark, and remembers the choice. */
export const ThemeToggle = () => {
  const { theme, setTheme } = useTheme();

  const next = () => {
    setTheme(THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length] ?? "system");
  };

  return (
    <IconButton label={`Theme: ${theme}`} onClick={next}>
      {ICONS[theme]}
    </IconButton>
  );
};
