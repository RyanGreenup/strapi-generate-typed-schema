import { recipe } from "@vanilla-extract/recipes";

export const bar = recipe({
  base: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottom: "1px solid rgba(0, 0, 0, 0.1)",
    padding: "15px 20px",
    fontFamily: '"Nunito Sans", "Helvetica Neue", Helvetica, Arial, sans-serif',
  },
});

export const logo = recipe({
  base: { display: "inline-block", verticalAlign: "top" },
});

export const title = recipe({
  base: {
    display: "inline-block",
    verticalAlign: "top",
    margin: "6px 0 6px 10px",
    fontWeight: 700,
    fontSize: 20,
    lineHeight: 1,
  },
});

export const actions = recipe({
  base: { display: "flex", alignItems: "center", gap: 10 },
});

export const welcome = recipe({
  base: { color: "#333", fontSize: 14 },
});
