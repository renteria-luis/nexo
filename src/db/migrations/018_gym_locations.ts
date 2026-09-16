// Spec 5.2: the gym is detected on arrival, which needs coordinates the seed never
// had. Fanshawe was seeded with lat and lng null in migration 012, and that one has
// already run on his phone, so this updates rather than edits it.
//
// Fanshawe is the whole campus rather than the building: the radius answers "am I at
// Fanshawe", which is the question the session needs, and the fitness centre sits
// inside it. Fit4Less is one unit in a plaza, so its radius is tight.
//
// Coordinates are from OpenStreetMap, not from a guess: Fanshawe College at 1001
// Fanshawe College Blvd, and the Fit4Less on Proudfoot Lane at Oxford, which is the
// one he named.
export const sql = `
UPDATE training_gym
   SET lat = 43.0136571, lng = -81.2012992, geofence_radius_m = 400
 WHERE id = 'fanshawe';

INSERT INTO training_gym (id, name, lat, lng, geofence_radius_m)
VALUES ('fit4less-proudfoot', 'Fit4Less Proudfoot', 42.9867629, -81.2882956, 150);
`;
