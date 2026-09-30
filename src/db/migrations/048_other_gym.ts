// Un gimnasio mas: el que no es ninguno de los dos.
//
// Entrena en Fanshawe y en Fit4Less, pero a veces esta en otro sitio, y hasta ahora eso
// no se podia decir: o mentia o dejaba el entreno sin gimnasio. Con esto la pregunta
// siempre tiene una respuesta verdadera, que es lo que permite exigirla.
//
// Sin coordenadas a proposito: la ubicacion no puede acertar con "otro", y spec 5.2 ya
// salta los gimnasios sin coordenadas en lugar de tratarlos como si estuvieran encima.
// Tampoco tiene equipo, asi que los ejercicios salen con el del plan y no con la
// variante de una maquina que ahi no hay.
export const sql = `
INSERT INTO training_gym (id, name, lat, lng, geofence_radius_m)
VALUES ('otro', 'Otro', NULL, NULL, 100);
`;
