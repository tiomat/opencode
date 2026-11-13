import { DateTime, Option, Schema, SchemaGetter } from "effect"

export const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0))
export const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

// Some providers (Alibaba DashScope) constrain generation by JSON Schema `pattern`
// with full-match semantics, so a bare prefix pattern like "^ses" forces the value
// to end right after the prefix. A template literal emits the anchored pattern
// "^ses[\s\S]*?$", equivalent to a prefix check under both readings.
export const startingWith = (prefix: string) => Schema.TemplateLiteral([prefix, Schema.String])

export const RelativePath = Schema.String.pipe(
  Schema.brand("RelativePath"),
  Schema.annotate({ identifier: "RelativePath" }),
)
export type RelativePath = typeof RelativePath.Type

export const AbsolutePath = Schema.String.pipe(
  Schema.brand("AbsolutePath"),
  Schema.annotate({ identifier: "AbsolutePath" }),
)
export type AbsolutePath = typeof AbsolutePath.Type

export const optional = <S extends Schema.Top>(schema: S) =>
  Schema.optionalKey(schema).pipe(
    Schema.decodeTo(Schema.optional(Schema.toType(schema)), {
      decode: SchemaGetter.passthrough({ strict: false }),
      encode: SchemaGetter.transformOptional(Option.filter((value) => value !== undefined)),
    }),
  )

// Effect schemas expose `make` through prototype getters, so `Object.assign` cannot override it.
// Defining the properties replaces a constructor as long as the schema's own `make` has not been read.
export const withStatics = <S extends object, M extends Record<string, unknown>>(schema: S, methods: M): S & M =>
  Object.defineProperties(schema, Object.getOwnPropertyDescriptors(methods)) as S & M

export const statics =
  <S extends object, M extends Record<string, unknown>>(methods: (schema: S) => M) =>
  (schema: S): S & M =>
    withStatics(schema, methods(schema))

export const DateTimeUtcFromMillis = Schema.Finite.pipe(
  Schema.decodeTo(Schema.DateTimeUtc, {
    decode: SchemaGetter.transform((value) => DateTime.makeUnsafe(value)),
    encode: SchemaGetter.transform((value) => DateTime.toEpochMillis(value)),
  }),
)
