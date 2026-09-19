// La torre de poleas Matrix de Fanshawe, con la torre leida por el en la maquina.
//
// Los ladrillos van 2.5, 7.5, 12.5 ... 97.5 lb: el primero pesa 2.5 y los otros
// diecinueve pesan 5 cada uno. El salto de 5 lb ya estaba bien; lo que faltaba eran
// los topes y, sobre todo, dejar de decir que era una suposicion.
//
// La 012 ya corrio en su telefono, asi que esto actualiza en vez de editarla.

const LB = 0.45359237;

export const sql = `
UPDATE training_equipment
   SET stack_min_kg = 2.5*${LB},
       stack_max_kg = 97.5*${LB},
       notes_es = 'Dos poleas de altura ajustable con barra y cuerda. Torre de 2.5 a 97.5 lb: el primer ladrillo pesa 2.5 y los demas 5, asi que sube de 5 en 5. Es donde haces el triceps por encima de la cabeza y el martillo.',
       increment_confirmed = 1
 WHERE id = 'fan-matrix-cable';
`;
