import type { ParentProps } from "solid-js";

import { createContext, Show, useContext } from "solid-js";

/** Creates a provider that initializes once per instance and a hook that throws outside it. */
export function createSimpleContext<T, Props extends Record<string, any>>(input: {
  name: string;
  init: ((input: Props) => T) | (() => T);
}) {
  const ctx = createContext<T>();

  return {
    context: ctx,
    provider: (props: ParentProps<Props>) => {
      // `ready` is a convention, not part of T: context values may expose a
      // boolean `ready` to defer rendering children until async init settles.
      const init = input.init(props) as T & { ready?: boolean };
      return (
        <Show when={init.ready === undefined || init.ready === true}>
          <ctx.Provider value={init}>{props.children}</ctx.Provider>
        </Show>
      );
    },
    use: () => {
      const value = useContext(ctx);
      if (value === undefined)
        throw new Error(`${input.name} context must be used within a context provider`);
      return value;
    },
  };
}
