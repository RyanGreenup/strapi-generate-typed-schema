import { StatusBar } from "@ryangreenup/tui-components";
import { keyHelp } from "@ryangreenup/tui-example-lib";

const help = keyHelp();

export function Footer(props: {
  count: number;
  cursor: number;
  themeName: string;
}) {
  return (
    <StatusBar
      left={[
        props.count ? `${props.cursor + 1}/${props.count}` : "0/0",
        props.themeName,
      ].join("  ")}
      items={help}
    />
  );
}
