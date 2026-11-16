/**
 * Types for what the Strapi 5 REST content API sends and accepts, derived from the
 * content types that `strapi ts:generate-types` writes to types/generated/.
 *
 * This file is not part of the library build. The library copies it beside a generated
 * entry file in a work directory, and typia turns each type into JSON Schema there. It
 * is compiled with the Strapi project's own `@strapi/strapi` types, so it cannot be
 * type-checked inside this package.
 *
 * Responses (`RestAnyDocument`): an OpenAPI operation has one response schema for every
 * query, so every attribute is optional (`fields` and `populate` select keys) and
 * nullable (a draft can leave any attribute empty). Modelled on the read pipeline:
 * - `documentId` and the primary key `id` are always present.
 * - sanitizeOutput removes password attributes and attributes with `private: true`, at
 *   every nested level.
 * - Dates are strings, a biginteger is a string, and a timestamp is the epoch in
 *   milliseconds as a string.
 *
 * Request bodies (`RestCreateBody`, `RestUpdateBody`): what the core create and update
 * actions accept.
 *
 * The `tags.*` intersections are typia annotations. They do not change the TypeScript
 * type, and typia turns each one into a JSON Schema keyword (format, pattern, minLength).
 *
 * Rules that a type cannot express, so the schemas do not have them:
 * - `unique`, custom validators, and the min and max of a biginteger.
 * - A create body lists every required attribute as required. Strapi only enforces most
 *   of them when the entry is published: a `?status=draft` create accepts less.
 * - Strapi also accepts `locale` in a body. It is left out here: send it as a query parameter.
 * - Keys hidden by `api.responses.privateAttributes`, custom fields (typed `unknown`),
 *   and custom controllers or middleware that rewrite a body.
 */
import type { Schema, UID } from "@strapi/strapi";
import type { tags } from "typia";

// ------------------------------------------------------------------ attribute classification

type Attrs<U extends UID.Schema> = Schema.Attributes<U>;
type AttrKey<U extends UID.Schema> = Extract<keyof Attrs<U>, string>;

type Hidden = { type: "password" } | { private: true };
type PopulatableType = "relation" | "media" | "component" | "dynamiczone";
type ToMany = "oneToMany" | "manyToMany" | "manyWay" | "morphMany";

type VisibleKey<U extends UID.Schema> = {
  [K in AttrKey<U>]: Attrs<U>[K] extends Hidden ? never : K;
}[AttrKey<U>];

type ScalarKey<U extends UID.Schema> = {
  [K in VisibleKey<U>]: Attrs<U>[K] extends { type: PopulatableType }
    ? never
    : K;
}[VisibleKey<U>];

type PopulatableKey<U extends UID.Schema> = Exclude<
  VisibleKey<U>,
  ScalarKey<U>
>;

// ------------------------------------------------------------------ vocabulary

/** Numeric row id. */
export type RowId = number & tags.Type<"int64"> & tags.ExclusiveMinimum<0>;
/** Document id (cuid2). */
export type DocumentId = string & tags.MinLength<1>;

export type JsonObject = { [key: string]: JsonValue };
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | JsonObject;

type Integer = number & tags.Type<"int64">;
type IntegerString = string & tags.Pattern<"^-?\\d+$">;
type DateString = string & tags.Format<"date">;
type DateTimeString = string & tags.Format<"date-time">;
/** HH:mm, HH:mm:ss or HH:mm:ss.SSS */
type TimeString = string &
  tags.Pattern<"^(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?$">;

type Jsonify<T> = T extends Date
  ? string
  : T extends readonly (infer E)[]
    ? Jsonify<E>[]
    : T extends object
      ? { [K in keyof T]: Jsonify<T[K]> }
      : T;

/** Attribute types with the same JSON form in a response and in a request body. */
type SharedValue<A> = A extends { type: "datetime" }
  ? DateTimeString
  : A extends { type: "date" }
    ? DateString
    : A extends { type: "time" }
      ? TimeString
      : A extends { type: "boolean" }
        ? boolean
        : A extends {
              type: "enumeration";
              enum: infer E extends readonly string[];
            }
          ? E[number]
          : A extends { type: "json" }
            ? JsonValue
            : A extends { type: "blocks" }
              ? Jsonify<
                  Schema.Attribute.Value<A & Schema.Attribute.AnyAttribute>
                >
              : unknown;

// ------------------------------------------------------------------ responses

type Ids<U extends UID.Schema> = U extends UID.ContentType
  ? { id: RowId; documentId: DocumentId }
  : { id: RowId };

type ScalarValue<A> = A extends {
  type: "string" | "text" | "richtext" | "email" | "uid";
}
  ? string
  : A extends { type: "timestamp" | "biginteger" }
    ? IntegerString // timestamp: epoch milliseconds
    : A extends { type: "integer" }
      ? Integer
      : A extends { type: "float" | "decimal" }
        ? number
        : SharedValue<A>;

/** The lifecycle subscriber database/src/lifecycles/subscribers/timestamps.ts always sets these. */
type AlwaysSet = "createdAt" | "updatedAt";

type PopulatedValue<A> = A extends {
  type: "relation";
  relation: infer R;
  target: infer T extends UID.ContentType;
}
  ? R extends ToMany
    ? RestAnyDocument<T>[]
    : RestAnyDocument<T>
  : A extends { type: "relation" }
    ? unknown // morphTo: no static target
    : // `multiple` and `repeatable` are optional in Strapi's attribute types: match `?: true`.
      A extends { type: "media"; multiple?: true }
      ? RestAnyDocument<"plugin::upload.file">[]
      : A extends { type: "media" }
        ? RestAnyDocument<"plugin::upload.file">
        : A extends {
              type: "component";
              component: infer C extends UID.Component;
              repeatable?: true;
            }
          ? RestAnyDocument<C>[]
          : A extends {
                type: "component";
                component: infer C extends UID.Component;
              }
            ? RestAnyDocument<C>
            : A extends {
                  type: "dynamiczone";
                  components: infer Cs extends readonly UID.Component[];
                }
              ? Array<{ [C in Cs[number]]: RestAnyZoneEntry<C> }[Cs[number]]>
              : never;

/**
 * One REST entry (content type or component) for a query that is only known at run time.
 *
 * This and the other generic object types below are plain intersections on purpose, without
 * a flattening helper: typia names a schema after the type alias, and a helper would hide it.
 */
export type RestAnyDocument<U extends UID.Schema> = Ids<U> & {
  [K in ScalarKey<U>]?: K extends AlwaysSet
    ? ScalarValue<Attrs<U>[K]>
    : ScalarValue<Attrs<U>[K]> | null;
} & { [K in PopulatableKey<U>]?: PopulatedValue<Attrs<U>[K]> | null };

/** A dynamic zone entry: the component and the tag that says which component it is. */
export type RestAnyZoneEntry<C extends UID.Component> = RestAnyDocument<C> & {
  __component: C;
};

export type RestPagination =
  | { page: number; pageSize: number; pageCount?: number; total?: number }
  | { start: number; limit: number; total?: number };

export type RestNoMeta = Record<string, never>;

export type RestAnyFindOne<U extends UID.ContentType> = {
  data: RestAnyDocument<U>;
  meta: RestNoMeta;
};

export type RestAnyFind<U extends UID.ContentType> = {
  data: RestAnyDocument<U>[];
  meta: { pagination: RestPagination };
};

/** The body of every non-2xx response (the strapi::errors middleware). */
export type RestError = {
  data: null;
  error: {
    status: number;
    name: string;
    message: string;
    details?: JsonObject;
  };
};

// ------------------------------------------------------------------ request bodies

/** The length and range options of an attribute as typia tags. `unknown` adds no constraint. */
type Length<A> = (A extends { minLength: infer N extends number }
  ? tags.MinLength<N>
  : unknown) &
  (A extends { maxLength: infer N extends number }
    ? tags.MaxLength<N>
    : unknown);
type Range<A> = (A extends { min: infer N extends number }
  ? tags.Minimum<N>
  : unknown) &
  (A extends { max: infer N extends number } ? tags.Maximum<N> : unknown);
type ItemCount<A> = (A extends { min: infer N extends number }
  ? tags.MinItems<N>
  : unknown) &
  (A extends { max: infer N extends number } ? tags.MaxItems<N> : unknown);

/** One related entry: a document id, a numeric id, or an object naming one. */
export type RelationRef =
  | DocumentId
  | RowId
  | {
      documentId: DocumentId;
      locale?: string | null;
      status?: "draft" | "published";
      position?: { [key: string]: unknown };
    }
  | { id: RowId; position?: { [key: string]: unknown } };

export type RelationOperations = {
  connect?: RelationRef | RelationRef[];
  disconnect?: RelationRef | RelationRef[];
  set?: RelationRef | RelationRef[];
};

type RelationInput<Many extends boolean> = Many extends true
  ? RelationRef[] | RelationOperations
  : RelationRef | RelationOperations;

type InputValue<A> = A extends { type: "string" | "text" | "richtext" }
  ? string & Length<A>
  : A extends { type: "password" }
    ? string // Strapi does not enforce minLength or maxLength on a password
    : A extends { type: "uid" }
      ? string & tags.Pattern<"^[A-Za-z0-9-_.~]*$"> & Length<A>
      : A extends { type: "email" }
        ? string & tags.Format<"email"> & Length<A>
        : A extends { type: "integer" }
          ? Integer & Range<A>
          : A extends { type: "float" | "decimal" }
            ? number & Range<A>
            : A extends { type: "biginteger" }
              ? IntegerString | Integer
              : A extends { type: "timestamp" }
                ? DateTimeString | Integer
                : A extends { type: PopulatableType }
                  ? StructuredInput<A>
                  : SharedValue<A>;

type StructuredInput<A> = A extends {
  type: "relation";
  relation: infer R;
  target: UID.ContentType;
}
  ? RelationInput<R extends ToMany ? true : false>
  : A extends { type: "relation" }
    ? JsonValue // morphTo: no static target
    : A extends { type: "media"; multiple?: true }
      ? RelationInput<true>
      : A extends { type: "media" }
        ? RelationInput<false>
        : A extends {
              type: "component";
              component: infer C extends UID.Component;
              repeatable?: true;
            }
          ? ComponentInput<C>[] & ItemCount<A>
          : A extends {
                type: "component";
                component: infer C extends UID.Component;
              }
            ? ComponentInput<C>
            : A extends {
                  type: "dynamiczone";
                  components: infer Cs extends readonly UID.Component[];
                }
              ? Array<{ [C in Cs[number]]: ZoneEntryInput<C> }[Cs[number]]> &
                  ItemCount<A>
              : unknown;

/** Set by Strapi, or (locale) sent as a query parameter instead. */
type NotWritable =
  | "createdAt"
  | "updatedAt"
  | "createdBy"
  | "updatedBy"
  | "locale"
  | "localizations";

type WritableKey<U extends UID.Schema> = Exclude<AttrKey<U>, NotWritable>;

type RequiredKey<U extends UID.Schema> = {
  [K in WritableKey<U>]: Attrs<U>[K] extends { required: true } ? K : never;
}[WritableKey<U>];

type OptionalInputs<U extends UID.Schema> = {
  [K in Exclude<WritableKey<U>, RequiredKey<U>>]?: InputValue<
    Attrs<U>[K]
  > | null;
};

/** The `data` of a create body: required attributes must be sent. */
export type RestCreateInput<U extends UID.Schema> = {
  [K in RequiredKey<U>]: InputValue<Attrs<U>[K]>;
} & OptionalInputs<U>;

/** The `data` of an update body: every attribute may be left out. */
export type RestUpdateInput<U extends UID.Schema> = {
  [K in RequiredKey<U>]?: InputValue<Attrs<U>[K]>;
} & OptionalInputs<U>;

/** A component entry is always sent whole. `id` keeps an existing entry instead of replacing it. */
export type ComponentInput<C extends UID.Component> = {
  id?: RowId;
} & RestCreateInput<C>;
export type ZoneEntryInput<C extends UID.Component> = ComponentInput<C> & {
  __component: C;
};

export type RestCreateBody<U extends UID.ContentType> = {
  data: RestCreateInput<U>;
};
export type RestUpdateBody<U extends UID.ContentType> = {
  data: RestUpdateInput<U>;
};
