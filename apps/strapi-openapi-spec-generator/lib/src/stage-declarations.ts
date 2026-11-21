import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

import type { ContentType } from "./content-types.js";
import type { Facts, Replace } from "./declaration-attributes.js";

import { attributeFacts } from "./declaration-attributes.js";
import { toRecord } from "./json.js";

type MetadataModel = Pick<ContentType, "uid" | "attributes">;
type DeclaredModels = Map<string, Map<string, Facts>>;
type Edits = Map<number, { end: number; text: string }>;

const readFields = (
  checker: ts.TypeChecker,
  owner: ts.Symbol,
  replace: Replace,
): Map<string, Facts> => {
  const attributes = checker.getTypeOfSymbol(owner).getProperty("attributes");
  const fields = new Map<string, Facts>();
  if (attributes !== undefined) {
    for (const property of checker
      .getTypeOfSymbol(attributes)
      .getProperties()) {
      const node = property.valueDeclaration;
      if (
        node !== undefined &&
        ts.isPropertySignature(node) &&
        node.type !== undefined
      ) {
        fields.set(property.name, attributeFacts(node.type, replace));
      }
    }
  }
  return fields;
};

function* registries(node: ts.Node): Generator<ts.InterfaceDeclaration> {
  if (ts.isSourceFile(node) || ts.isModuleBlock(node)) {
    for (const statement of node.statements) {
      yield* registries(statement);
    }
  } else if (
    ts.isModuleDeclaration(node) &&
    (node.name.text === "@strapi/strapi" || node.name.text === "Public") &&
    node.body !== undefined
  ) {
    yield* registries(node.body);
  } else if (
    ts.isInterfaceDeclaration(node) &&
    (node.name.text === "ContentTypeSchemas" ||
      node.name.text === "ComponentSchemas")
  ) {
    yield node;
  }
}

const stagedText = (file: ts.SourceFile, edits: Edits | undefined): string => {
  if (edits === undefined) {
    return file.text;
  }
  let position = 0;
  const pieces: string[] = [];
  for (const [start, edit] of [...edits].toSorted(([a], [b]) => a - b)) {
    pieces.push(file.text.slice(position, start), edit.text);
    position = edit.end;
  }
  pieces.push(file.text.slice(position));
  return pieces.join("");
};

// Bind just the generated registry and its interfaces, not Strapi's dependency graph.
const declarationProgram = (projectDirectory: string): ts.Program => {
  const files = ts.sys.readDirectory(
    path.join(projectDirectory, "types/generated"),
    [".d.ts"],
    undefined,
    ["*.d.ts"],
  );
  return ts.createProgram(files, { noLib: true, noResolve: true, types: [] });
};

/** Read facts once from the originals; compile private copies with effective numeric operands. */
const stageDeclarations = async (
  projectDirectory: string,
  work: string,
): Promise<DeclaredModels> => {
  const program = declarationProgram(projectDirectory);
  const checker = program.getTypeChecker();
  const models: DeclaredModels = new Map();
  const edits = new Map<ts.SourceFile, Edits>();
  const replace: Replace = (node, text) => {
    const file = node.getSourceFile();
    const locations =
      edits.get(file) ?? new Map<number, { end: number; text: string }>();
    locations.set(node.getStart(file), { end: node.end, text });
    edits.set(file, locations);
  };
  const files = program.getSourceFiles();
  for (const file of files) {
    for (const registry of registries(file)) {
      for (const owner of checker.getTypeAtLocation(registry).getProperties()) {
        if (!models.has(owner.name)) {
          models.set(owner.name, readFields(checker, owner, replace));
        }
      }
    }
  }
  const directory = path.join(work, "generated");
  await mkdir(directory);
  await Promise.all(
    files.map((file) =>
      writeFile(
        path.join(directory, path.basename(file.fileName)),
        stagedText(file, edits.get(file)),
      ),
    ),
  );
  return models;
};

/** Restrict declaration metadata to discovered owners; explicit JSON keys take precedence. */
const metadataModels = (
  declared: DeclaredModels,
  owners: { uid: string }[],
  sources: MetadataModel[],
): MetadataModel[] => {
  const models: DeclaredModels = new Map();
  for (const { uid } of owners) {
    const fields = declared.get(uid);
    if (fields !== undefined) {
      models.set(uid, fields);
    }
  }
  for (const source of sources) {
    const fields = models.get(source.uid) ?? new Map<string, Facts>();
    for (const [key, value] of Object.entries(source.attributes)) {
      fields.set(key, { ...fields.get(key), ...toRecord(value) });
    }
    models.set(source.uid, fields);
  }
  return Array.from(models, ([uid, fields]) => ({
    uid,
    attributes: Object.fromEntries(fields),
  }));
};

export { metadataModels, stageDeclarations };
export type { MetadataModel };
