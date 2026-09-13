export type Migration = {
  id: string;
  sql: string;
};

// Applied in array order and never edited once shipped. Adding a table means
// appending an entry, not changing one.
export const migrations: Migration[] = [];
