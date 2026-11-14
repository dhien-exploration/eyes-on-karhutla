// Every failure to load a data product becomes a DataError, so the UI can show
// a clear error state instead of rendering wrong or empty data.
//
//   network   the request failed or the server answered with an error status
//   missing   the file is not there (404, or the dev server's HTML fallback)
//   parse     the response is not valid JSON
//   schema    the JSON does not match public/data/v1/schema/*.schema.json
//   contract  schema-valid, but breaks a rule the schema cannot express
//             (parallel arrays of unequal length, wrong province, ...)
export type DataErrorKind = 'network' | 'missing' | 'parse' | 'schema' | 'contract'

export class DataError extends Error {
  readonly kind: DataErrorKind
  /** Path relative to the data root, e.g. "provinces/ID-KT/daily.json". */
  readonly file: string

  constructor(kind: DataErrorKind, file: string, message: string, options?: { cause?: unknown }) {
    super(`${file}: ${message}`, options)
    this.name = 'DataError'
    this.kind = kind
    this.file = file
  }
}
