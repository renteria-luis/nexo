// Las pistas de elevaciones laterales describian la version de pie con mancuernas,
// pero en Fit4Less el ejercicio esta enlazado a la maquina Nautilus IPDR3 y ahi el
// movimiento no es el mismo. Un texto que solo habla de un caso es peor que ninguno
// cuando estas parado delante del otro.
export const sql = `
UPDATE training_exercise SET technique_text = 'Con mancuernas o polea, de pie: codo con flexion ligera y fija.
En maquina (IPDR3): espalda y costados pegados al respaldo, el brazo empuja la almohadilla, no la mano.
Sube hasta la altura del hombro, no mas.
Lleva el codo, no la mano: la mano nunca va por delante del codo.
Baja en 2 segundos, sin rebote.
Error comun: subir con impulso de cadera y encoger el trapecio.'
WHERE id = 'lateral-raise';
`;
