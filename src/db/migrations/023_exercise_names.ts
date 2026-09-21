// Los nombres que el usa en el gym, y el salto de las dominadas.
//
// Los nombres que tenia el catalogo eran traducciones literales que el no dice en
// voz alta. "Contractor de pecho" es la pec deck y punto.
//
// Las dominadas tenian un salto de 2.5 kg, que mostrado en libras sale 5.51: un
// numero que no existe en ningun cinturon. Las hace a peso corporal y cuando use
// lastre sera en discos de libras, asi que el salto es 2.5 lb.
//
// La 008 ya corrio en su telefono, asi que esto actualiza en vez de editarla.

const LB = 0.45359237;

export const sql = `
UPDATE training_exercise SET name_es = 'Pec deck' WHERE id = 'peck-deck';
UPDATE training_exercise SET name_es = 'Rear delt fly' WHERE id = 'reverse-pec-deck';
UPDATE training_exercise SET name_es = 'Remo' WHERE id = 'cable-row-narrow';
UPDATE training_exercise SET load_increment = 2.5*${LB} WHERE id = 'pull-up';
`;
