// Each Transit place carries the icon the map draws for it. The public places seeded by 062
// get theirs here; a place he adds starts as a plain pin until he picks one.
export const sql = `
ALTER TABLE transit_place ADD COLUMN icon TEXT NOT NULL DEFAULT 'pin';
UPDATE transit_place SET icon = 'gym' WHERE id IN ('fit4less', 'fanshawe-gym');
UPDATE transit_place SET icon = 'grocery' WHERE id IN ('costco', 'food-basics');
UPDATE transit_place SET icon = 'cinema' WHERE id = 'masonville-cinema';
UPDATE transit_place SET icon = 'mall' WHERE id = 'masonville-door';
`;
