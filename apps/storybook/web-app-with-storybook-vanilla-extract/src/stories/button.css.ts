import { recipe } from "@vanilla-extract/recipes";

const font = '"Nunito Sans", "Helvetica Neue", Helvetica, Arial, sans-serif';

export const button = recipe({
  base: {
    display: "inline-block",
    cursor: "pointer",
    border: 0,
    borderRadius: "3em",
    fontWeight: 700,
    lineHeight: 1,
    fontFamily: font,
  },
  variants: {
    mode: {
      primary: { backgroundColor: "#555ab9", color: "white" },
      secondary: {
        boxShadow: "rgba(0, 0, 0, 0.15) 0px 0px 0px 1px inset",
        backgroundColor: "transparent",
        color: "#333",
      },
    },
    size: {
      small: { padding: "10px 16px", fontSize: 12 },
      medium: { padding: "11px 20px", fontSize: 14 },
      large: { padding: "12px 24px", fontSize: 16 },
    },
  },
  defaultVariants: { mode: "secondary", size: "medium" },
});
