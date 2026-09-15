// Settings the spec asks for in several places: the palette (4.5), the activity
// factor and phase (3.6), the missing sleep toggle (3.5) and the re-entry window
// (6.5). Key and value rather than a column each, because a new setting should not
// need a migration.
//
// This is also where the owner's height and birth date live. They are not in the
// source and never will be: the repository is public.
export const sql = `
CREATE TABLE core_setting (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;
`;
