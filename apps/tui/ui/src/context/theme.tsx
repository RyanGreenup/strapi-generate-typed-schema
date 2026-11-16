// Adapted from @opencode-ai/tui (github.com/anomalyco/opencode,
// packages/tui/src/context/theme.tsx, MIT licensed). Keeps the upstream
// call-site contract (`const { theme } = useTheme()` with reactive field
// access), terminal palette detection (the "system" theme), dark/light mode
// events, and syntax style generation. Dropped: useKV persistence,
// useTuiConfig config coupling, the @opencode-ai/core Global/Glob
// filesystem theme discovery, the SIGUSR2 refresh hook, and the mode lock
// (pin/free collapse into a plain setMode). The ThemeSource seam is kept so
// a host app can inject its own discovery; the default source discovers
// nothing.
import type { SyntaxStyle, TerminalColors } from "@opentui/core";

import type { Theme, ThemeJson } from "../theme";
import { CliRenderEvents } from "@opentui/core";
import { useRenderer } from "@opentui/solid";
import { createComputed, createEffect, createMemo, onCleanup, onMount } from "solid-js";

import { createStore } from "solid-js/store";

import {
  allThemes,
  generateSubtleSyntax,
  generateSyntax,
  generateSystem,
  hasTheme,
  isTheme,
  resolveTheme,
  setCustomThemes,
  setSystemTheme,
  subscribeThemes,
  terminalMode,
} from "../theme";
import { createSimpleContext } from "./helper";

export type ThemeSource = Readonly<{
  discover: () => Promise<Record<string, unknown>>;
  subscribeRefresh?: (refresh: () => void) => () => void;
}>;

const emptySource: ThemeSource = {
  discover: async () => ({}),
};

export interface ThemeProviderProps {
  mode?: "dark" | "light";
  theme?: string;
  source?: ThemeSource;
  // Children render only once terminal palette detection and custom theme
  // discovery settle (default true), so the first frame already has the
  // right theme and dark/light mode. Detection can take ~300ms (the
  // OTUI_PALETTE_IDLE_TIMEOUT_MS quiet period). Pass false to render
  // immediately with `theme`/`mode`; detection still runs and updates the
  // theme when it finishes, which can visibly switch the mode (e.g. on a
  // light terminal) or a custom/system theme on the first frames.
  waitForTerminal?: boolean;
}

const THEME_REFRESH_DELAYS = [250, 1000] as const;

interface State {
  themes: Record<string, ThemeJson>;
  mode: "dark" | "light";
  active: string;
  ready: boolean;
}

/** Provides terminal-aware theme state and a hook whose theme fields stay reactive on access. */
export const { use: useTheme, provider: ThemeProvider } = createSimpleContext({
  name: "Theme",
  init: (props: ThemeProviderProps) => {
    const renderer = useRenderer();
    const [store, setStore] = createStore<State>({
      themes: allThemes(),
      mode: "dark",
      active: "opencode",
      ready: false,
    });
    const source = () => props.source ?? emptySource;
    const pick = (value: unknown) => {
      if (value === "dark" || value === "light") return value;
      return undefined;
    };

    setStore("ready", false);
    // createComputed keeps the original synchronous init timing while also
    // applying later prop changes.
    createComputed(() => setStore("active", props.theme ?? "opencode"));
    createComputed(() => setStore("mode", pick(renderer.themeMode) ?? props.mode ?? "dark"));

    let sourceGeneration = 0;
    async function syncCustomThemes(currentSource: ThemeSource, generation: number) {
      try {
        const themes = await currentSource.discover();
        if (generation !== sourceGeneration) return;
        setCustomThemes(
          Object.entries(themes).reduce<Record<string, ThemeJson>>((result, [name, theme]) => {
            if (isTheme(theme)) result[name] = theme;
            return result;
          }, {}),
        );
      } catch {
        if (generation !== sourceGeneration) return;
        setStore("active", "opencode");
      }
    }

    createEffect(() => {
      const currentSource = source();
      const generation = ++sourceGeneration;
      const unsubscribe = currentSource.subscribeRefresh?.(refresh);
      if (generation > 1) void syncCustomThemes(currentSource, generation);
      onCleanup(() => unsubscribe?.());
    });

    const unsubscribeThemes = subscribeThemes((themes) => setStore("themes", themes));
    onCleanup(unsubscribeThemes);

    onMount(() => {
      const currentSource = source();
      const generation = sourceGeneration;
      if (props.waitForTerminal === false) setStore("ready", true);
      void Promise.allSettled([
        resolveSystemTheme(store.mode),
        syncCustomThemes(currentSource, generation),
      ]).finally(() => {
        setStore("ready", true);
      });
    });

    let systemThemeSignature: string | undefined;
    let systemThemeMode: "dark" | "light" | undefined;
    let hasResolvedSystemTheme = false;
    async function resolveSystemTheme(mode: "dark" | "light") {
      try {
        const colors: TerminalColors = await renderer.getPalette({ size: 16 });
        const base = colors.palette[0];
        if (base === undefined || base === "") {
          if (hasResolvedSystemTheme) return;
          setSystemTheme(undefined);
          if (store.active === "system") setStore("active", "opencode");
          return;
        }
        const next = terminalMode(colors) ?? mode;
        if (store.mode !== next) setStore("mode", next);
        const signature = JSON.stringify(colors);
        hasResolvedSystemTheme = true;
        if (store.themes.system && systemThemeSignature === signature && systemThemeMode === next)
          return;
        systemThemeSignature = signature;
        systemThemeMode = next;
        setSystemTheme(generateSystem(colors, next));
      } catch {
        if (hasResolvedSystemTheme) return;
        setSystemTheme(undefined);
        if (store.active === "system") setStore("active", "opencode");
      }
    }

    let systemRefreshRunning = false;
    let systemRefreshQueued = false;
    let systemRefreshMode: "dark" | "light" = "dark";
    function refreshSystemTheme(mode: "dark" | "light") {
      systemRefreshMode = mode;
      if (systemRefreshRunning) {
        systemRefreshQueued = true;
        return;
      }

      systemRefreshRunning = true;
      const retry = renderer.paletteDetectionStatus === "detecting";
      renderer.clearPaletteCache();
      void resolveSystemTheme(mode).finally(() => {
        systemRefreshRunning = false;
        if (!retry && !systemRefreshQueued) return;
        systemRefreshQueued = false;
        refreshSystemTheme(systemRefreshMode);
      });
    }

    function refreshSystemThemeFromCurrentMode() {
      refreshSystemTheme(store.mode);
    }

    function apply(mode: "dark" | "light") {
      if (store.mode === mode) return;
      setStore("mode", mode);
      refreshSystemTheme(mode);
    }

    const handle = (mode: "dark" | "light") => apply(mode);

    const handleThemeNotification = (sequence: string) => {
      if (sequence === "\x1B[?997;1n" || sequence === "\x1B[?997;2n") {
        queueMicrotask(refreshSystemThemeFromCurrentMode);
      }
      // Never consume the sequence; other handlers may want it too.
      return false;
    };

    onMount(() => {
      renderer.on(CliRenderEvents.THEME_MODE, handle);
      renderer.prependInputHandler(handleThemeNotification);
    });

    let themeRefreshTimeouts: ReturnType<typeof setTimeout>[] = [];
    function refresh() {
      for (const timeout of themeRefreshTimeouts) clearTimeout(timeout);
      themeRefreshTimeouts = THEME_REFRESH_DELAYS.map((delay) =>
        setTimeout(() => {
          refreshSystemThemeFromCurrentMode();
          if (delay === THEME_REFRESH_DELAYS[THEME_REFRESH_DELAYS.length - 1])
            void syncCustomThemes(source(), sourceGeneration);
        }, delay),
      );
    }

    onCleanup(() => {
      renderer.off(CliRenderEvents.THEME_MODE, handle);
      renderer.removeInputHandler(handleThemeNotification);
      for (const timeout of themeRefreshTimeouts) clearTimeout(timeout);
      themeRefreshTimeouts.length = 0;
    });

    const values = createMemo(() => {
      const active = store.themes[store.active] ?? store.themes.opencode;
      if (!active) throw new Error("no theme named opencode is registered");
      return resolveTheme(active, store.mode);
    });

    createEffect(() => renderer.setBackgroundColor(values().background));

    const syntax = createSyntaxStyleMemo(() => generateSyntax(values()));
    const subtleSyntax = createSyntaxStyleMemo(() => generateSubtleSyntax(values()));

    return {
      // The target is a dummy: every read is forwarded to the current memo
      // value so `theme.textMuted` etc. stay reactive at the access site.
      theme: new Proxy({} as Theme, {
        get: (_target, prop) => values()[prop as keyof Theme],
      }),
      get selected() {
        return store.active;
      },
      all: allThemes,
      has: hasTheme,
      syntax,
      subtleSyntax,
      mode: () => store.mode,
      setMode: apply,
      set: (theme: string) => {
        if (!hasTheme(theme)) return false;
        setStore("active", theme);
        return true;
      },
      get ready() {
        return store.ready;
      },
    };
  },
});

/** Tracks syntax styles in a reactive owner and destroys replaced styles after renderer idle. */
export function createSyntaxStyleMemo(factory: () => SyntaxStyle) {
  const renderer = useRenderer();
  const retained = new Set<SyntaxStyle>();
  let current: SyntaxStyle | undefined;

  const release = (style: SyntaxStyle) => {
    retained.add(style);
    void renderer
      .idle()
      .catch(() => {})
      .finally(() => {
        if (!retained.delete(style)) return;
        style.destroy();
      });
  };

  onCleanup(() => {
    if (current) release(current);
  });

  const style = createMemo(() => {
    const previous = current;
    current = factory();
    if (previous) release(previous);
    return current;
  });
  return style;
}
