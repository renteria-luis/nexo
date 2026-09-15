// Spec 10 layer 1: four to six imperative lines per exercise, covering setup,
// execution and the error he is most likely to make. Written rather than filmed
// because generated media cannot be verified and scraped media is copyrighted.
//
// Layer 2, his own clip on his own machine, has a column waiting for it
// (technique_clip_ref) and needs camera access the app does not ask for yet.
//
// An UPDATE rather than an edit to migration 008: that one has already run on his
// phone and would be skipped there forever.
export const sql = `
UPDATE training_exercise SET technique_text = 'Banco a 30 grados, pies planos en el piso.
Mancuernas a la altura del pecho bajo, munecas sobre los codos.
Codos a unos 45 grados del torso, no abiertos a 90.
Empuja arriba y un poco hacia adentro, sin chocar las mancuernas.
Baja hasta sentir el estiramiento en el pecho alto, cerca de 1 segundo.
Error comun: el banco muy inclinado lo convierte en press de hombro.'
WHERE id = 'incline-db-press';

UPDATE training_exercise SET technique_text = 'Asiento a la altura que deja las manijas en linea con el pecho.
Espalda pegada al respaldo, codos con una flexion ligera y fija.
Junta con el pecho, no con las manos: piensa en cerrar los codos.
Aguanta medio segundo al final y vuelve controlando el estiramiento.
Error comun: abrir tanto atras que los hombros se van adelante.'
WHERE id = 'peck-deck';

UPDATE training_exercise SET technique_text = 'Asiento a la altura que deja las manijas en el pecho medio.
Munecas rectas, codos a unos 45 grados del torso.
Empuja sin bloquear del todo el codo.
Vuelve hasta que las manos quedan a la altura del pecho.
Error comun: subir el asiento y terminar empujando hacia arriba.'
WHERE id = 'seated-chest-press';

UPDATE training_exercise SET technique_text = 'Polea a la altura de la cintura, de espaldas a la torre.
Codos apuntando al frente y pegados a la cabeza.
Solo se mueve el antebrazo, el codo se queda en su sitio.
Estira hasta arriba sin bloquear de golpe.
Error comun: abrir los codos y convertirlo en un press.'
WHERE id = 'overhead-triceps';

UPDATE training_exercise SET technique_text = 'Polea alta, codos pegados al costado.
Torso casi vertical, inclinacion minima.
Baja hasta estirar el codo, sin tiron al final.
Sube solo hasta 90 grados de codo para no perder tension.
Error comun: mover los hombros y empujar con el pecho.'
WHERE id = 'triceps-pulldown';

UPDATE training_exercise SET technique_text = 'De pie, mancuernas al costado, codo con flexion ligera.
Sube hasta la altura del hombro, no mas.
Lleva el codo, no la mano: la mano nunca va por delante del codo.
Baja en 2 segundos, sin rebote.
Error comun: subir con impulso de cadera y encoger el trapecio.'
WHERE id = 'lateral-raise';

UPDATE training_exercise SET technique_text = 'Agarre un poco mas ancho que los hombros.
Empieza colgado con los hombros abajo y atras.
Lleva los codos al bolsillo, pecho hacia la barra.
Baja completo y controlado, sin dejarte caer.
Error comun: cortar el recorrido abajo para sumar repeticiones.'
WHERE id = 'pull-up';

UPDATE training_exercise SET technique_text = 'Rodillas algo flexionadas, espalda neutra, pecho arriba.
Jala con los codos pegados al costado hasta el abdomen.
Junta las escapulas al final, sin echar el torso atras.
Estira adelante dejando viajar la escapula, sin redondear la espalda.
Error comun: usar la cadera como balancin.'
WHERE id = 'cable-row-narrow';

UPDATE training_exercise SET technique_text = 'Banco entre 45 y 60 grados, brazos colgando atras del cuerpo.
Codos quietos, no viajan hacia adelante.
Sube girando la muneca hasta que el menique apunta arriba.
Baja completo hasta estirar el biceps, 2 segundos.
Error comun: subir el hombro para ayudar en la ultima parte.'
WHERE id = 'incline-curl';

UPDATE training_exercise SET technique_text = 'Agarre neutro, palmas enfrentadas.
Codos al costado, muneca recta y firme.
Sube sin mover el codo hacia adelante.
Baja completo, controlando todo el recorrido.
Error comun: balancear el torso para arrancar el peso.'
WHERE id = 'hammer-curl';

UPDATE training_exercise SET technique_text = 'Axilas apoyadas en el respaldo, codos firmes sobre el acolchado.
Agarre en la parte inclinada de la barra Z, muneca neutra.
Baja hasta casi estirar, sin soltar la tension abajo.
Sube sin levantar los codos del apoyo.
Error comun: estirar de golpe abajo, donde el codo esta mas expuesto.'
WHERE id = 'preacher-curl';

UPDATE training_exercise SET technique_text = 'Pecho contra el respaldo, asiento a la altura del hombro.
Codos casi estirados y fijos todo el recorrido.
Abre con los codos hacia atras, no con las manos.
Aguanta medio segundo atras y vuelve controlando.
Error comun: encoger los hombros y terminar trabajando el trapecio.'
WHERE id = 'reverse-pec-deck';

UPDATE training_exercise SET technique_text = 'Espalda apoyada, rodillas alineadas con los soportes.
Junta las piernas de forma controlada, sin golpe.
Aguanta medio segundo al cerrar.
Abre despacio hasta sentir el estiramiento, sin llegar al limite.
Error comun: abrir al maximo con peso alto.'
WHERE id = 'hip-adductor';

UPDATE training_exercise SET technique_text = 'Pies a la anchura de los hombros, algo adelante en la plataforma.
Espalda y cadera pegadas al respaldo todo el recorrido.
Baja hasta que el muslo pasa la paralela, rodilla en linea con el pie.
Sube sin bloquear la rodilla de golpe.
Error comun: despegar la cadera abajo, que es donde se lesiona la espalda.'
WHERE id = 'hack-squat';

UPDATE training_exercise SET technique_text = 'Respaldo ajustado para que la rodilla quede en el eje de giro.
Rodillo sobre el empeine, no sobre la espinilla.
Estira hasta arriba y aguanta medio segundo.
Baja en 2 segundos sin soltar el peso.
Error comun: levantar la cadera del asiento para pasar las ultimas.'
WHERE id = 'leg-extension';

UPDATE training_exercise SET technique_text = 'Eje de la maquina alineado con la rodilla.
Cadera pegada al asiento o a la camilla.
Flexiona hasta el final del recorrido y aguanta medio segundo.
Vuelve controlando, sin dejar caer la pila.
Error comun: despegar la cadera para ganar rango.'
WHERE id = 'leg-curl';
`;
