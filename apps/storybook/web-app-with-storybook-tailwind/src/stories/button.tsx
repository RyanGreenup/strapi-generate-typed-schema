import type { Component } from "solid-js";

const sizes = {
  small: "px-4 py-2.5 text-xs",
  medium: "px-5 py-[11px] text-sm",
  large: "px-6 py-3 text-base",
} as const;

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
      "inline-block cursor-pointer rounded-[3em] border-0 font-sans leading-none font-bold",
      sizes[props.size ?? "medium"],
      props.primary === true
        ? "bg-[#555ab9] text-white"
        : "bg-transparent text-[#333] shadow-[rgba(0,0,0,0.15)_0px_0px_0px_1px_inset]",
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
