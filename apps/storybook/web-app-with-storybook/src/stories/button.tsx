import type { Component } from "solid-js";

import "./button.css";

export interface ButtonProps {
  primary?: boolean;
  backgroundColor?: string;
  size?: "small" | "medium" | "large";
  label: string;
  onClick?: () => void;
}

/** Primary UI component for user interaction */
export const Button: Component<ButtonProps> = (props) => (
  <button
    type="button"
    class={[
      "storybook-button",
      `storybook-button--${props.size ?? "medium"}`,
      props.primary === true
        ? "storybook-button--primary"
        : "storybook-button--secondary",
    ].join(" ")}
    style={
      props.backgroundColor === undefined
        ? undefined
        : { "background-color": props.backgroundColor }
    }
    onClick={() => {
      props.onClick?.();
    }}
  >
    {props.label}
  </button>
);
