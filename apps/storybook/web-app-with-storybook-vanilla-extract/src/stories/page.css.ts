import { recipe } from "@vanilla-extract/recipes";

export const page = recipe({
  base: {
    margin: "0 auto",
    padding: "48px 20px",
    maxWidth: 600,
    color: "#333",
    fontSize: 14,
    lineHeight: "24px",
    fontFamily: '"Nunito Sans", "Helvetica Neue", Helvetica, Arial, sans-serif',
  },
});

export const heading = recipe({
  base: {
    display: "inline-block",
    verticalAlign: "top",
    margin: "0 0 4px",
    fontWeight: 700,
    fontSize: 32,
    lineHeight: 1,
  },
});

export const paragraph = recipe({ base: { margin: "1em 0" } });

export const link = recipe({ base: { color: "inherit" } });

export const list = recipe({ base: { margin: "1em 0", paddingLeft: 30 } });

export const listItem = recipe({ base: { marginBottom: 8 } });

export const tipWrapper = recipe({
  base: {
    marginTop: 40,
    marginBottom: 40,
    fontSize: 13,
    lineHeight: "20px",
  },
});

export const tip = recipe({
  base: {
    display: "inline-block",
    verticalAlign: "top",
    marginRight: 10,
    borderRadius: "1em",
    background: "#e7fdd8",
    padding: "4px 12px",
    color: "#357a14",
    fontWeight: 700,
    fontSize: 11,
    lineHeight: "12px",
  },
});

export const tipIcon = recipe({
  base: {
    display: "inline-block",
    verticalAlign: "top",
    marginTop: 3,
    marginRight: 4,
    width: 12,
    height: 12,
  },
});
