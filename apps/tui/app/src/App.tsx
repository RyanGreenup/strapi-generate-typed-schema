import { ThemeProvider } from "@ryangreenup/tui-components";

import { Main } from "./ui/Main.tsx";

// Theme colors (useTheme) are only available inside ThemeProvider.
// waitForTerminal={false} draws the first frame at once instead of waiting
// ~300ms for terminal palette detection.
export function App(props: { items?: readonly string[] }) {
  return (
    <ThemeProvider waitForTerminal={false}>
      <Main items={props.items} />
    </ThemeProvider>
  );
}
