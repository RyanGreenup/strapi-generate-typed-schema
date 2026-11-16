import type { Component } from "solid-js";

import { button } from "./button.css";

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
    class={button({
      mode: props.primary === true ? "primary" : "secondary",
      size: props.size ?? "medium",
    })}
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
