// User-defined map groups. Existing places remain visible under «Sin categoría».
export const sql = `
ALTER TABLE transit_place ADD COLUMN category TEXT NOT NULL DEFAULT '';
`;
