// Border presets copied unchanged from opencode
// (.agents/opencode/packages/tui/src/ui/border.ts).
// EmptyBorder keeps box padding without drawing lines; SplitBorder draws
// only a heavy vertical rule on the left/right edges.
export const EmptyBorder = {
  topLeft: "",
  bottomLeft: "",
  vertical: "",
  topRight: "",
  bottomRight: "",
  horizontal: " ",
  bottomT: "",
  topT: "",
  cross: "",
  leftT: "",
  rightT: "",
};

export const SplitBorder = {
  border: ["left" as const, "right" as const],
  customBorderChars: {
    ...EmptyBorder,
    vertical: "┃",
  },
};
