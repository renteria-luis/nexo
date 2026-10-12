// A place carries the words he searches it by ("gym, fit, gimnasio") and, if he gives one, an
// importance from 1 to 10: the lists of places start at 1 and leave the unranked last, by name.
export const sql = `
ALTER TABLE transit_place ADD COLUMN tags TEXT NOT NULL DEFAULT '';
ALTER TABLE transit_place ADD COLUMN importance INTEGER CHECK(importance BETWEEN 1 AND 10);
`;
