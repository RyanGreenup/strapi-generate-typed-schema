import type { ContentType } from "./content-types.js";
import type { SchemaRoot } from "./schema-identity.js";

import { pascalCase, schemaNames } from "./names.js";

type Identity = Omit<SchemaRoot, "schema">;
interface Probe {
  type: string;
  identity: Identity;
}
type Variant = [
  generic: string,
  name: string,
  mode?: NonNullable<Identity["mode"]>,
  flags?: string,
  publishedInput?: boolean,
];

// The flag-dispatch aliases may be emitted independently of their concrete branches.
// They come after the concrete variants: the first root naming a shared typia
// component becomes its canonical name, and later roots become aliases of it.
const dispatchVariants: Variant[] = [];
for (const state of ["Published", "Draft"]) {
  dispatchVariants.push([`Rest${state}ZoneEntry`, `${state}Block`, "response"]);
  for (const action of ["Create", "Update"]) {
    const mode = action === "Create" ? "create" : "update";
    const flags = `, ${state === "Published"}, ${action === "Update"}`;
    dispatchVariants.push([
      `Rest${state}${action}Input`,
      `${state}${action}Input`,
      mode,
      "",
      state === "Published",
    ]);
    for (const kind of ["Entry", "Zone"]) {
      dispatchVariants.push([
        `${kind}Input`,
        `${state}${action}${kind}Helper`,
        mode,
        flags,
        state === "Published",
      ]);
    }
  }
}

const componentVariants: readonly Variant[] = [
  ["PublishedExistingComponentInput", "PublishedExistingEntryInput", "update"],
  ["PublishedNewComponentInput", "PublishedNewEntryInput", "create"],
  ["PublishedExistingZoneInput", "PublishedExistingBlockInput", "update"],
  ["PublishedNewZoneInput", "PublishedNewBlockInput", "create"],
  ["PublishedCreateComponentInput", "PublishedCreateEntryInput", "create"],
  ["DraftCreateComponentInput", "DraftCreateEntryInput", "create"],
  ["PublishedComponentInput", "PublishedEntryInput", "create"],
  ["DraftComponentInput", "DraftEntryInput", "update"],
  ["PublishedCreateZoneInput", "PublishedCreateBlockInput", "create"],
  ["DraftCreateZoneInput", "DraftCreateBlockInput", "create"],
  ["PublishedUpdateZoneInput", "PublishedUpdateBlockInput", "update"],
  ["DraftUpdateZoneInput", "DraftUpdateBlockInput", "update"],
  ...dispatchVariants,
];
interface Model {
  uid: string;
  drafts: boolean;
  component?: boolean;
  content?: ContentType;
}

const operationVariants = (model: ContentType): Variant[] => {
  const names = schemaNames(model.uid);
  const prefix = pascalCase(model.uid);
  const variants: Variant[] = [["RestAnyFindOne", names.one]];
  const actions = ["Update"];
  if (model.kind !== "singleType") {
    variants.push(["RestAnyFind", names.list]);
    actions.unshift("Create");
  }
  const states = model.draftAndPublish ? ["Published", "Draft"] : ["Published"];
  for (const action of actions) {
    const mode = action === "Create" ? "create" : "update";
    for (const state of states) {
      variants.push(
        [
          `Rest${state}${action}Input`,
          `${prefix}${state}${action}Input`,
          mode,
          "",
          state === "Published",
        ],
        [`Rest${state}${action}Body`, `${prefix}${state}${action}Request`],
      );
    }
    variants.push(
      [
        `Rest${action}Input`,
        `${prefix}${action}Input`,
        mode,
        "",
        !model.draftAndPublish,
      ],
      [`Rest${action}Body`, names[mode]],
    );
  }
  return variants;
};

/** Pair each supported REST template instantiation with its model identity. */
const modelProbes = ({
  uid,
  component = false,
  drafts,
  content,
}: Model): Probe[] => {
  const prefix = pascalCase(uid);
  const argument = JSON.stringify(uid);
  const probe = (
    [generic, name, mode, flags = "", publishedInput = false]: Variant,
    state?: Identity["state"],
  ): Probe => {
    const type = `T.${generic}<${argument}${flags}>`;
    const identity: Identity = { uid, name };
    if (mode !== undefined) {
      identity.mode = mode;
    }
    if (publishedInput) identity.publishedInput = true;
    if (state !== undefined) {
      identity.state = state;
    }
    return { identity, type };
  };
  const roots = [
    probe(
      ["RestPublishedDocument", `${prefix}PublishedDocument`, "response"],
      "published",
    ),
  ];
  if (drafts) {
    roots.push(
      probe(
        ["RestDraftDocument", `${prefix}DraftDocument`, "response"],
        "draft",
      ),
    );
  }
  roots.push(
    probe(["RestAnyDocument", `${prefix}Document`, "response"], "document"),
  );
  if (content !== undefined) {
    roots.push(...operationVariants(content).map((variant) => probe(variant)));
  }
  if (component) {
    for (const [
      generic,
      suffix,
      mode = "response",
      flags = "",
      published,
    ] of componentVariants) {
      const publishedInput =
        mode !== "response" && (published ?? suffix.startsWith("Published"));
      roots.push(
        probe([generic, `${prefix}${suffix}`, mode, flags, publishedInput]),
      );
    }
  }
  return roots;
};
export { modelProbes };
export type { Model };
