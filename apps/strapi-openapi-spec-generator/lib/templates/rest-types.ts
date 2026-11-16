/**
 * Types for what the Strapi 5 REST content API sends and accepts, derived from the
 * content types that `strapi ts:generate-types` writes to types/generated/.
 *
 * This file is not part of the library build. The library copies it beside a generated
 * entry file in a work directory, and typia turns each type into JSON Schema there. It
 * is compiled with the Strapi project's own `@strapi/strapi` types, so it cannot be
 * type-checked inside this package.
 *
 * Responses (`RestAnyDocument`): keys remain optional because `fields` and `populate`
 * select them. Published entries retain validation constraints and required values are
 * non-null when selected; drafts retain only the constraints Strapi enforces on drafts.
 * Components and draft-and-publish relation targets follow the selected publication state.
 * - `documentId` and the primary key `id` are always present.
 * - sanitizeOutput removes passwords and `private: true` attributes at every level.
 * - Dates, bigintegers, and epoch-millisecond timestamps are strings.
 *
 * Request bodies (`RestCreateBody`, `RestUpdateBody`): what the core create and update
 * actions accept.
 *
 * The `tags.*` intersections are typia annotations. They do not change the TypeScript
 * type, and typia turns each one into a JSON Schema keyword (format, pattern, minLength).
 *
 * Rules that a type cannot express, so the schemas do not have them:
 * - `unique`, schema regexes, custom validators, and the min and max of a biginteger.
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

/** Draft validation skips lower bounds and email validation, but keeps scalar upper bounds. */
type ResponseLength<A, Published extends boolean> = (Published extends true
  ? A extends { minLength: infer N extends number }
    ? tags.MinLength<N>
    : unknown
  : unknown) &
  (A extends { maxLength: infer N extends number }
    ? tags.MaxLength<N>
    : A extends { type: "string" }
      ? tags.MaxLength<255>
      : unknown);

type ResponseRange<A, Published extends boolean> = (Published extends true
  ? A extends { min: infer N extends number }
    ? tags.Minimum<N>
    : unknown
  : unknown) &
  (A extends { max: infer N extends number } ? tags.Maximum<N> : unknown);

type ScalarValue<A, Published extends boolean> = A extends {
  type: "string" | "text" | "richtext" | "uid";
}
  ? string & ResponseLength<A, Published>
  : A extends { type: "email" }
    ? string &
        ResponseLength<A, Published> &
        (Published extends true ? tags.Format<"email"> : unknown)
    : A extends { type: "timestamp" | "biginteger" }
      ? IntegerString // timestamp: epoch milliseconds
      : A extends { type: "integer" }
        ? Integer & ResponseRange<A, Published>
        : A extends { type: "float" | "decimal" }
          ? number & ResponseRange<A, Published>
          : SharedValue<A>;

/** The lifecycle subscriber database/src/lifecycles/subscribers/timestamps.ts always sets these. */
type AlwaysSet = "createdAt" | "updatedAt";

/** Optional component arrays may be empty even when their configured minimum is positive. */
type PublishedArray<E, A> = A extends { required: true }
  ? E[] & ItemCount<A>
  : A extends { min: infer N extends number }
    ? N extends 0
      ? E[] & ItemCount<A>
      : (E[] & tags.MaxItems<0>) | (E[] & ItemCount<A>)
    : E[] & ItemCount<A>;

/** The query layer propagates status to populated targets that support draft-and-publish. */
type RelatedDocument<T extends UID.ContentType, Published extends boolean> =
  Schema.Schema<T> extends { options: { draftAndPublish: true } }
    ? Published extends true
      ? RestPublishedDocument<T>
      : RestDraftDocument<T>
    : RestPublishedDocument<T>;

type PopulatedValue<A, Published extends boolean> = A extends {
  type: "relation";
  relation: infer R;
  target: infer T extends UID.ContentType;
}
  ? R extends ToMany
    ? RelatedDocument<T, Published>[]
    : RelatedDocument<T, Published>
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
          ? Published extends true
            ? PublishedArray<RestPublishedDocument<C>, A>
            : RestDraftDocument<C>[]
          : A extends {
                type: "component";
                component: infer C extends UID.Component;
              }
            ? Published extends true
              ? RestPublishedDocument<C>
              : RestDraftDocument<C>
            : A extends {
                  type: "dynamiczone";
                  components: infer Cs extends readonly UID.Component[];
                }
              ? Published extends true
                ? PublishedArray<
                    {
                      [C in Cs[number]]: RestPublishedZoneEntry<C>;
                    }[Cs[number]],
                    A
                  >
                : Array<
                    {
                      [C in Cs[number]]: RestDraftZoneEntry<C>;
                    }[Cs[number]]
                  >
              : never;

/**
 * A published entry. All selected required scalar and component values are non-null.
 * Relations and media can still be absent after population and output sanitization.
 *
 * Keep these objects as plain intersections: typia uses their alias as the schema name.
 */
export type RestPublishedDocument<U extends UID.Schema> = Ids<U> & {
  [K in ScalarKey<U>]?: K extends
    | AlwaysSet
    | (U extends UID.ContentType ? "publishedAt" : never)
    ? ScalarValue<Attrs<U>[K], true>
    : Attrs<U>[K] extends { required: true }
      ? Exclude<ScalarValue<Attrs<U>[K], true>, null>
      : ScalarValue<Attrs<U>[K], true> | null;
} & {
  [K in PopulatableKey<U>]?: Attrs<U>[K] extends {
    type: "component" | "dynamiczone";
    required: true;
  }
    ? PopulatedValue<Attrs<U>[K], true>
    : PopulatedValue<Attrs<U>[K], true> | null;
};

/** A draft entry, including components validated as part of a draft owner. */
export type RestDraftDocument<U extends UID.Schema> = Ids<U> & {
  [K in ScalarKey<U>]?: K extends AlwaysSet
    ? ScalarValue<Attrs<U>[K], false>
    : K extends (U extends UID.ContentType ? "publishedAt" : never)
      ? null
      : ScalarValue<Attrs<U>[K], false> | null;
} & { [K in PopulatableKey<U>]?: PopulatedValue<Attrs<U>[K], false> | null };

/**
 * A runtime-selected entry. Without draft-and-publish, writes use published validation.
 * Otherwise either state is valid. `publishedAt` is optional because fields can omit it,
 * so the two branches may overlap and their JSON Schema union must not be exclusive.
 */
export type RestAnyDocument<U extends UID.Schema> =
  Schema.Schema<U> extends { options: { draftAndPublish: false } }
    ? RestPublishedDocument<U>
    : RestPublishedDocument<U> | RestDraftDocument<U>;

/** A dynamic zone entry, with the component discriminator retained in both states. */
export type RestPublishedZoneEntry<C extends UID.Component> =
  RestPublishedDocument<C> & { __component: C };
export type RestDraftZoneEntry<C extends UID.Component> =
  RestDraftDocument<C> & { __component: C };

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

/** `unknown` adds no constraint. Scalar bounds are shared with response validation. */
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

type InputValue<
  A,
  Published extends boolean,
  Updating extends boolean,
> = A extends { type: "password" }
  ? string // Strapi's password validator ignores length options.
  : A extends { type: "uid" }
    ? string &
        ResponseLength<A, Published> &
        (Published extends true ? tags.Pattern<"^[A-Za-z0-9-_.~]*$"> : unknown)
    : A extends { type: "biginteger" }
      ? IntegerString | Integer
      : A extends { type: "timestamp" }
        ? DateTimeString | Integer
        : A extends { type: PopulatableType }
          ? StructuredInput<A, Published, Updating>
          : ScalarValue<A, Published>;

type EntryInput<
  C extends UID.Component,
  Published extends boolean,
  Updating extends boolean,
> = Updating extends true
  ? Published extends true
    ? PublishedComponentInput<C>
    : DraftComponentInput<C>
  : Published extends true
    ? PublishedCreateComponentInput<C>
    : DraftCreateComponentInput<C>;

type ZoneInput<
  C extends UID.Component,
  Published extends boolean,
  Updating extends boolean,
> = Updating extends true
  ? Published extends true
    ? PublishedUpdateZoneInput<C>
    : DraftUpdateZoneInput<C>
  : Published extends true
    ? PublishedCreateZoneInput<C>
    : DraftCreateZoneInput<C>;

type InputArray<E, A, Published extends boolean> = Published extends true
  ? PublishedArray<E, A>
  : E[];

type StructuredInput<
  A,
  Published extends boolean,
  Updating extends boolean,
> = A extends { type: "relation"; relation: infer R; target: UID.ContentType }
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
          ? InputArray<EntryInput<C, Published, Updating>, A, Published>
          : A extends {
                type: "component";
                component: infer C extends UID.Component;
              }
            ? EntryInput<C, Published, Updating>
            : A extends {
                  type: "dynamiczone";
                  components: infer Cs extends readonly UID.Component[];
                }
              ? InputArray<
                  {
                    [C in Cs[number]]: ZoneInput<C, Published, Updating>;
                  }[Cs[number]],
                  A,
                  Published
                >
              : unknown;

/** Set by Strapi, or (locale) sent as a query parameter instead. */
type NotWritable =
  | "id"
  | "documentId"
  | "createdAt"
  | "updatedAt"
  | "createdBy"
  | "updatedBy"
  | "publishedAt"
  | "locale"
  | "localizations";

type WritableKey<U extends UID.Schema> = {
  [K in Exclude<AttrKey<U>, NotWritable>]: Attrs<U>[K] extends {
    writable: false;
  }
    ? never
    : K;
}[Exclude<AttrKey<U>, NotWritable>];

type ArrayAttribute =
  | { type: "dynamiczone" }
  | { type: "component"; repeatable?: true };

/** Default `strictRelations: false` does not enforce relation/media required markers.
 * Projects enabling that runtime flag need additional validation; generated types do not expose it. */
type RequiredInput<A, Published extends boolean> = A extends {
  type: "relation" | "media";
}
  ? false
  : A extends ArrayAttribute
    ? true
    : Published extends true
      ? A extends { required: true }
        ? true
        : false
      : false;

type InputField<A, Published extends boolean, Updating extends boolean> =
  | InputValue<A, Published, Updating>
  | (RequiredInput<A, Published> extends true ? never : null);

type CreateRequiredKey<U extends UID.Schema, Published extends boolean> = {
  [K in WritableKey<U>]: Attrs<U>[K] extends { default: unknown }
    ? never
    : Attrs<U>[K] extends { required: true }
      ? RequiredInput<Attrs<U>[K], Published> extends true
        ? K
        : never
      : never;
}[WritableKey<U>];

export type RestPublishedCreateInput<U extends UID.Schema> = {
  [K in CreateRequiredKey<U, true>]: InputField<Attrs<U>[K], true, false>;
} & {
  [K in Exclude<WritableKey<U>, CreateRequiredKey<U, true>>]?: InputField<
    Attrs<U>[K],
    true,
    false
  >;
};
export type RestDraftCreateInput<U extends UID.Schema> = {
  [K in CreateRequiredKey<U, false>]: InputField<Attrs<U>[K], false, false>;
} & {
  [K in Exclude<WritableKey<U>, CreateRequiredKey<U, false>>]?: InputField<
    Attrs<U>[K],
    false,
    false
  >;
};

/** Omitted update fields keep their existing values; new nested components still use create rules. */
export type RestPublishedUpdateInput<U extends UID.Schema> = {
  [K in WritableKey<U>]?: InputField<Attrs<U>[K], true, true>;
};
export type RestDraftUpdateInput<U extends UID.Schema> = {
  [K in WritableKey<U>]?: InputField<Attrs<U>[K], false, true>;
};

type HasDrafts<U extends UID.Schema> =
  Schema.Schema<U> extends {
    options: { draftAndPublish: true };
  }
    ? true
    : false;

/** D&P operation bodies accept drafts; status-specific aliases express publication constraints. */
export type RestCreateInput<U extends UID.Schema> =
  HasDrafts<U> extends true
    ? RestDraftCreateInput<U>
    : RestPublishedCreateInput<U>;
export type RestUpdateInput<U extends UID.Schema> =
  HasDrafts<U> extends true
    ? RestDraftUpdateInput<U>
    : RestPublishedUpdateInput<U>;

/** An id identifies an existing component, whose omitted values are retained. */
export type PublishedComponentInput<C extends UID.Component> =
  | PublishedExistingComponentInput<C>
  | PublishedNewComponentInput<C>;
export type DraftComponentInput<C extends UID.Component> = {
  id?: RowId;
} & RestDraftUpdateInput<C>;
export type PublishedExistingComponentInput<C extends UID.Component> = {
  id: RowId;
} & RestPublishedUpdateInput<C>;
export type PublishedNewComponentInput<C extends UID.Component> = {
  id?: never;
} & RestPublishedCreateInput<C>;

/** Named shapes keep component and zone metadata addressable after typia expansion. */
export type PublishedCreateComponentInput<C extends UID.Component> = {
  id?: RowId;
} & RestPublishedCreateInput<C>;
export type DraftCreateComponentInput<C extends UID.Component> = {
  id?: RowId;
} & RestDraftCreateInput<C>;
export type PublishedCreateZoneInput<C extends UID.Component> =
  PublishedCreateComponentInput<C> & { __component: C };
export type DraftCreateZoneInput<C extends UID.Component> =
  DraftCreateComponentInput<C> & { __component: C };
export type PublishedUpdateZoneInput<C extends UID.Component> =
  | PublishedExistingZoneInput<C>
  | PublishedNewZoneInput<C>;
export type DraftUpdateZoneInput<C extends UID.Component> =
  DraftComponentInput<C> & { __component: C };
export type PublishedExistingZoneInput<C extends UID.Component> =
  PublishedExistingComponentInput<C> & { __component: C };
export type PublishedNewZoneInput<C extends UID.Component> =
  PublishedNewComponentInput<C> & { __component: C };

export type RestPublishedCreateBody<U extends UID.ContentType> = {
  data: RestPublishedCreateInput<U>;
};
export type RestDraftCreateBody<U extends UID.ContentType> = {
  data: RestDraftCreateInput<U>;
};
export type RestPublishedUpdateBody<U extends UID.ContentType> = {
  data: RestPublishedUpdateInput<U>;
};
export type RestDraftUpdateBody<U extends UID.ContentType> = {
  data: RestDraftUpdateInput<U>;
};

export type RestCreateBody<U extends UID.ContentType> = {
  data: RestCreateInput<U>;
};
export type RestUpdateBody<U extends UID.ContentType> = {
  data: RestUpdateInput<U>;
};
