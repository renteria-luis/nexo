// Las tildes que les faltaban a los textos sembrados: nombres de ejercicios, la tecnica
// de cada uno, lo que dice cada estudio en Lecturas y algunos alimentos (2026-10-23).
// Solo cambia la fila que sigue diciendo exactamente lo sembrado: lo que el ya edito
// se queda como lo dejo.
export const sql = `
UPDATE training_exercise SET name_es = 'Press de pecho sentado en máquina'
 WHERE id = 'seated-chest-press' AND name_es = 'Press de pecho sentado en maquina';
UPDATE training_exercise SET name_es = 'Extensión de tríceps sobre la cabeza'
 WHERE id = 'overhead-triceps' AND name_es = 'Extension de triceps sobre la cabeza';
UPDATE training_exercise SET name_es = 'Extensión de tríceps en polea alta'
 WHERE id = 'triceps-pulldown' AND name_es = 'Extension de triceps en polea alta';
UPDATE training_exercise SET name_es = 'Máquina de aductores'
 WHERE id = 'hip-adductor' AND name_es = 'Maquina de aductores';
UPDATE training_exercise SET name_es = 'Extensión de piernas'
 WHERE id = 'leg-extension' AND name_es = 'Extension de piernas';
UPDATE training_exercise SET name_es = 'Elevaciones laterales en máquina'
 WHERE id = 'lateral-raise-machine' AND name_es = 'Elevaciones laterales en maquina';
UPDATE training_exercise_note SET note = 'Banco a 30 grados, pies planos en el piso.
Mancuernas a la altura del pecho bajo, muñecas sobre los codos.
Codos a unos 45 grados del torso, no abiertos a 90.
Empuja arriba y un poco hacia adentro, sin chocar las mancuernas.
Baja hasta sentir el estiramiento en el pecho alto, cerca de 1 segundo.
Error común: el banco muy inclinado lo convierte en press de hombro.'
 WHERE exercise_id = 'incline-db-press' AND implement = '' AND note = 'Banco a 30 grados, pies planos en el piso.
Mancuernas a la altura del pecho bajo, munecas sobre los codos.
Codos a unos 45 grados del torso, no abiertos a 90.
Empuja arriba y un poco hacia adentro, sin chocar las mancuernas.
Baja hasta sentir el estiramiento en el pecho alto, cerca de 1 segundo.
Error comun: el banco muy inclinado lo convierte en press de hombro.';
UPDATE training_exercise_note SET note = 'Asiento a la altura que deja las manijas en línea con el pecho.
Espalda pegada al respaldo, codos con una flexión ligera y fija.
Junta con el pecho, no con las manos: piensa en cerrar los codos.
Aguanta medio segundo al final y vuelve controlando el estiramiento.
Error común: abrir tanto atrás que los hombros se van adelante.'
 WHERE exercise_id = 'peck-deck' AND implement = '' AND note = 'Asiento a la altura que deja las manijas en linea con el pecho.
Espalda pegada al respaldo, codos con una flexion ligera y fija.
Junta con el pecho, no con las manos: piensa en cerrar los codos.
Aguanta medio segundo al final y vuelve controlando el estiramiento.
Error comun: abrir tanto atras que los hombros se van adelante.';
UPDATE training_exercise_note SET note = 'Asiento a la altura que deja las manijas en el pecho medio.
Muñecas rectas, codos a unos 45 grados del torso.
Empuja sin bloquear del todo el codo.
Vuelve hasta que las manos quedan a la altura del pecho.
Error común: subir el asiento y terminar empujando hacia arriba.'
 WHERE exercise_id = 'seated-chest-press' AND implement = '' AND note = 'Asiento a la altura que deja las manijas en el pecho medio.
Munecas rectas, codos a unos 45 grados del torso.
Empuja sin bloquear del todo el codo.
Vuelve hasta que las manos quedan a la altura del pecho.
Error comun: subir el asiento y terminar empujando hacia arriba.';
UPDATE training_exercise_note SET note = 'Polea a la altura de la cintura, de espaldas a la torre.
Codos apuntando al frente y pegados a la cabeza.
Solo se mueve el antebrazo, el codo se queda en su sitio.
Estira hasta arriba sin bloquear de golpe.
Error común: abrir los codos y convertirlo en un press.'
 WHERE exercise_id = 'overhead-triceps' AND implement = '' AND note = 'Polea a la altura de la cintura, de espaldas a la torre.
Codos apuntando al frente y pegados a la cabeza.
Solo se mueve el antebrazo, el codo se queda en su sitio.
Estira hasta arriba sin bloquear de golpe.
Error comun: abrir los codos y convertirlo en un press.';
UPDATE training_exercise_note SET note = 'Polea alta, codos pegados al costado.
Torso casi vertical, inclinación mínima.
Baja hasta estirar el codo, sin tirón al final.
Sube solo hasta 90 grados de codo para no perder tensión.
Error común: mover los hombros y empujar con el pecho.'
 WHERE exercise_id = 'triceps-pulldown' AND implement = '' AND note = 'Polea alta, codos pegados al costado.
Torso casi vertical, inclinacion minima.
Baja hasta estirar el codo, sin tiron al final.
Sube solo hasta 90 grados de codo para no perder tension.
Error comun: mover los hombros y empujar con el pecho.';
UPDATE training_exercise_note SET note = 'Con mancuernas o polea, de pie: codo con flexión ligera y fija.
En máquina (IPDR3): espalda y costados pegados al respaldo, el brazo empuja la almohadilla, no la mano.
Sube hasta la altura del hombro, no más.
Lleva el codo, no la mano: la mano nunca va por delante del codo.
Baja en 2 segundos, sin rebote.
Error común: subir con impulso de cadera y encoger el trapecio.'
 WHERE exercise_id = 'lateral-raise' AND implement = '' AND note = 'Con mancuernas o polea, de pie: codo con flexion ligera y fija.
En maquina (IPDR3): espalda y costados pegados al respaldo, el brazo empuja la almohadilla, no la mano.
Sube hasta la altura del hombro, no mas.
Lleva el codo, no la mano: la mano nunca va por delante del codo.
Baja en 2 segundos, sin rebote.
Error comun: subir con impulso de cadera y encoger el trapecio.';
UPDATE training_exercise_note SET note = 'Agarre un poco más ancho que los hombros.
Empieza colgado con los hombros abajo y atrás.
Lleva los codos al bolsillo, pecho hacia la barra.
Baja completo y controlado, sin dejarte caer.
Error común: cortar el recorrido abajo para sumar repeticiones.'
 WHERE exercise_id = 'pull-up' AND implement = '' AND note = 'Agarre un poco mas ancho que los hombros.
Empieza colgado con los hombros abajo y atras.
Lleva los codos al bolsillo, pecho hacia la barra.
Baja completo y controlado, sin dejarte caer.
Error comun: cortar el recorrido abajo para sumar repeticiones.';
UPDATE training_exercise_note SET note = 'Rodillas algo flexionadas, espalda neutra, pecho arriba.
Jala con los codos pegados al costado hasta el abdomen.
Junta las escápulas al final, sin echar el torso atrás.
Estira adelante dejando viajar la escápula, sin redondear la espalda.
Error común: usar la cadera como balancín.'
 WHERE exercise_id = 'cable-row-narrow' AND implement = '' AND note = 'Rodillas algo flexionadas, espalda neutra, pecho arriba.
Jala con los codos pegados al costado hasta el abdomen.
Junta las escapulas al final, sin echar el torso atras.
Estira adelante dejando viajar la escapula, sin redondear la espalda.
Error comun: usar la cadera como balancin.';
UPDATE training_exercise_note SET note = 'Banco entre 45 y 60 grados, brazos colgando atrás del cuerpo.
Codos quietos, no viajan hacia adelante.
Sube girando la muñeca hasta que el meñique apunta arriba.
Baja completo hasta estirar el bíceps, 2 segundos.
Error común: subir el hombro para ayudar en la última parte.'
 WHERE exercise_id = 'incline-curl' AND implement = '' AND note = 'Banco entre 45 y 60 grados, brazos colgando atras del cuerpo.
Codos quietos, no viajan hacia adelante.
Sube girando la muneca hasta que el menique apunta arriba.
Baja completo hasta estirar el biceps, 2 segundos.
Error comun: subir el hombro para ayudar en la ultima parte.';
UPDATE training_exercise_note SET note = 'Agarre neutro, palmas enfrentadas.
Codos al costado, muñeca recta y firme.
Sube sin mover el codo hacia adelante.
Baja completo, controlando todo el recorrido.
Error común: balancear el torso para arrancar el peso.'
 WHERE exercise_id = 'hammer-curl' AND implement = '' AND note = 'Agarre neutro, palmas enfrentadas.
Codos al costado, muneca recta y firme.
Sube sin mover el codo hacia adelante.
Baja completo, controlando todo el recorrido.
Error comun: balancear el torso para arrancar el peso.';
UPDATE training_exercise_note SET note = 'Axilas apoyadas en el respaldo, codos firmes sobre el acolchado.
Agarre en la parte inclinada de la barra Z, muñeca neutra.
Baja hasta casi estirar, sin soltar la tensión abajo.
Sube sin levantar los codos del apoyo.
Error común: estirar de golpe abajo, donde el codo está más expuesto.'
 WHERE exercise_id = 'preacher-curl' AND implement = '' AND note = 'Axilas apoyadas en el respaldo, codos firmes sobre el acolchado.
Agarre en la parte inclinada de la barra Z, muneca neutra.
Baja hasta casi estirar, sin soltar la tension abajo.
Sube sin levantar los codos del apoyo.
Error comun: estirar de golpe abajo, donde el codo esta mas expuesto.';
UPDATE training_exercise_note SET note = 'Pecho contra el respaldo, asiento a la altura del hombro.
Codos casi estirados y fijos todo el recorrido.
Abre con los codos hacia atrás, no con las manos.
Aguanta medio segundo atrás y vuelve controlando.
Error común: encoger los hombros y terminar trabajando el trapecio.'
 WHERE exercise_id = 'reverse-pec-deck' AND implement = '' AND note = 'Pecho contra el respaldo, asiento a la altura del hombro.
Codos casi estirados y fijos todo el recorrido.
Abre con los codos hacia atras, no con las manos.
Aguanta medio segundo atras y vuelve controlando.
Error comun: encoger los hombros y terminar trabajando el trapecio.';
UPDATE training_exercise_note SET note = 'Espalda apoyada, rodillas alineadas con los soportes.
Junta las piernas de forma controlada, sin golpe.
Aguanta medio segundo al cerrar.
Abre despacio hasta sentir el estiramiento, sin llegar al límite.
Error común: abrir al máximo con peso alto.'
 WHERE exercise_id = 'hip-adductor' AND implement = '' AND note = 'Espalda apoyada, rodillas alineadas con los soportes.
Junta las piernas de forma controlada, sin golpe.
Aguanta medio segundo al cerrar.
Abre despacio hasta sentir el estiramiento, sin llegar al limite.
Error comun: abrir al maximo con peso alto.';
UPDATE training_exercise_note SET note = 'Pies a la anchura de los hombros, algo adelante en la plataforma.
Espalda y cadera pegadas al respaldo todo el recorrido.
Baja hasta que el muslo pasa la paralela, rodilla en línea con el pie.
Sube sin bloquear la rodilla de golpe.
Error común: despegar la cadera abajo, que es donde se lesiona la espalda.'
 WHERE exercise_id = 'hack-squat' AND implement = '' AND note = 'Pies a la anchura de los hombros, algo adelante en la plataforma.
Espalda y cadera pegadas al respaldo todo el recorrido.
Baja hasta que el muslo pasa la paralela, rodilla en linea con el pie.
Sube sin bloquear la rodilla de golpe.
Error comun: despegar la cadera abajo, que es donde se lesiona la espalda.';
UPDATE training_exercise_note SET note = 'Respaldo ajustado para que la rodilla quede en el eje de giro.
Rodillo sobre el empeine, no sobre la espinilla.
Estira hasta arriba y aguanta medio segundo.
Baja en 2 segundos sin soltar el peso.
Error común: levantar la cadera del asiento para pasar las últimas.'
 WHERE exercise_id = 'leg-extension' AND implement = '' AND note = 'Respaldo ajustado para que la rodilla quede en el eje de giro.
Rodillo sobre el empeine, no sobre la espinilla.
Estira hasta arriba y aguanta medio segundo.
Baja en 2 segundos sin soltar el peso.
Error comun: levantar la cadera del asiento para pasar las ultimas.';
UPDATE training_exercise_note SET note = 'Eje de la máquina alineado con la rodilla.
Cadera pegada al asiento o a la camilla.
Flexiona hasta el final del recorrido y aguanta medio segundo.
Vuelve controlando, sin dejar caer la pila.
Error común: despegar la cadera para ganar rango.'
 WHERE exercise_id = 'leg-curl' AND implement = '' AND note = 'Eje de la maquina alineado con la rodilla.
Cadera pegada al asiento o a la camilla.
Flexiona hasta el final del recorrido y aguanta medio segundo.
Vuelve controlando, sin dejar caer la pila.
Error comun: despegar la cadera para ganar rango.';
UPDATE training_exercise_note SET note = 'Polea en el punto más bajo, de pie al costado, el cable cruza por delante del cuerpo.
Sujeta la torre con la otra mano y no acompañes con el tronco.
Codo con flexión ligera y fija, sube hasta la altura del hombro.
Baja en 2 segundos: la polea sigue tirando abajo, que es justo lo que la mancuerna no hace.
Error común: girar el cuerpo para ayudarse en la última repetición.'
 WHERE exercise_id = 'lateral-raise-cable' AND implement = '' AND note = 'Polea en el punto mas bajo, de pie al costado, el cable cruza por delante del cuerpo.
Sujeta la torre con la otra mano y no acompanes con el tronco.
Codo con flexion ligera y fija, sube hasta la altura del hombro.
Baja en 2 segundos: la polea sigue tirando abajo, que es justo lo que la mancuerna no hace.
Error comun: girar el cuerpo para ayudarse en la ultima repeticion.';
UPDATE training_exercise_note SET note = 'Agarre prono, manos a la anchura de los hombros, codos pegados al costado.
Sube sin mover el codo de sitio: lo único que gira es el antebrazo.
Bajada de dos segundos, y abajo estira del todo sin soltar la muñeca.
Repeticiones altas, de 12 a 15: el antebrazo aguanta y responde a eso.
Error común: subir el peso y terminar haciendo un curl con las muñecas dobladas.'
 WHERE exercise_id = 'reverse-curl' AND implement = '' AND note = 'Agarre prono, manos a la anchura de los hombros, codos pegados al costado.
Sube sin mover el codo de sitio: lo unico que gira es el antebrazo.
Bajada de dos segundos, y abajo estira del todo sin soltar la muneca.
Repeticiones altas, de 12 a 15: el antebrazo aguanta y responde a eso.
Error comun: subir el peso y terminar haciendo un curl con las munecas dobladas.';
UPDATE training_exercise_note SET note = 'Siéntate con la espalda pegada al respaldo y los codos contra las almohadillas.
Sube hasta la altura del hombro, no más: por encima entra el trapecio.
Baja en 2 segundos, sin dejar que el peso golpee la torre.
La máquina te quita el impulso del tronco, que es su ventaja sobre la mancuerna.
Error común: empujar con las manos en vez de con los codos.'
 WHERE exercise_id = 'lateral-raise-machine' AND implement = '' AND note = 'Sientate con la espalda pegada al respaldo y los codos contra las almohadillas.
Sube hasta la altura del hombro, no mas: por encima entra el trapecio.
Baja en 2 segundos, sin dejar que el peso golpee la torre.
La maquina te quita el impulso del tronco, que es su ventaja sobre la mancuerna.
Error comun: empujar con las manos en vez de con los codos.';
UPDATE training_exercise_note SET note = 'Agarre neutro, palmas enfrentadas.
Codos al costado, muñeca recta y firme.
Sube sin mover el codo hacia adelante.
Baja completo, controlando todo el recorrido.
Error común: balancear el torso para arrancar el peso.'
 WHERE exercise_id = 'hammer-curl-variant-dumbbell' AND implement = '' AND note = 'Agarre neutro, palmas enfrentadas.
Codos al costado, muneca recta y firme.
Sube sin mover el codo hacia adelante.
Baja completo, controlando todo el recorrido.
Error comun: balancear el torso para arrancar el peso.';
UPDATE core_study SET summary = 'Una noche sin dormir: síntesis de proteína muscular -18%, cortisol +21%, testosterona -24%.'
 WHERE id = 'lamon-2021' AND summary = 'Una noche sin dormir: sintesis de proteina muscular -18%, cortisol +21%, testosterona -24%.';
UPDATE core_study SET summary = 'Ocho noches de 5 horas: testosterona diurna -10 a -15%, con menos ánimo y vigor.'
 WHERE id = 'leproult-2011' AND summary = 'Ocho noches de 5 horas: testosterona diurna -10 a -15%, con menos animo y vigor.';
UPDATE core_study SET summary = 'En déficit, 5.5 h contra 8.5 h de sueño: 60% más masa magra perdida y 55% menos grasa perdida.'
 WHERE id = 'nedeltcheva-2010' AND summary = 'En deficit, 5.5 h contra 8.5 h de sueno: 60% mas masa magra perdida y 55% menos grasa perdida.';
UPDATE core_study SET summary = 'Cinco noches de 4 horas bajaron la síntesis muscular, pero entrenar durante esa racha la mantuvo en niveles normales. Entrenar protege parcialmente una mala racha de sueño.'
 WHERE id = 'saner-2020' AND summary = 'Cinco noches de 4 horas bajaron la sintesis muscular, pero entrenar durante esa racha la mantuvo en niveles normales. Entrenar protege parcialmente una mala racha de sueno.';
UPDATE core_study SET summary = '1.5 g/kg, unos 12 tragos: síntesis de proteína -24% junto con proteína y -37% junto con carbohidrato.'
 WHERE id = 'parr-2014' AND summary = '1.5 g/kg, unos 12 tragos: sintesis de proteina -24% junto con proteina y -37% junto con carbohidrato.';
UPDATE core_study SET summary = 'Las caídas de fuerza y de marcadores anabólicos van con la dosis. La respuesta de testosterona varía mucho entre personas.'
 WHERE id = 'alcohol-review-2023' AND summary = 'Las caidas de fuerza y de marcadores anabolicos van con la dosis. La respuesta de testosterona varia mucho entre personas.';
UPDATE core_study SET summary = 'El riesgo de hipertensión sube casi en línea recta y ya pesa arriba de unos 12 g al día.'
 WHERE id = 'cecchini-2024' AND summary = 'El riesgo de hipertension sube casi en linea recta y ya pesa arriba de unos 12 g al dia.';
UPDATE core_study SET summary = '49 estudios y 1863 participantes: la ganancia de masa magra deja de subir en 1.62 g/kg al día. Es de donde sale tu meta de proteína.'
 WHERE id = 'morton-2018' AND summary = '49 estudios y 1863 participantes: la ganancia de masa magra deja de subir en 1.62 g/kg al dia. Es de donde sale tu meta de proteina.';
UPDATE core_study SET summary = 'Pasar de 40% a 20% de la energía como grasa bajó la testosterona total 10 a 15%. Es la base de la banda de 25 a 33% de grasa y del piso de 0.8 g/kg.'
 WHERE id = 'whittaker-2021' AND summary = 'Pasar de 40% a 20% de la energia como grasa bajo la testosterona total 10 a 15%. Es la base de la banda de 25 a 33% de grasa y del piso de 0.8 g/kg.';
UPDATE core_study SET summary = '67 estudios y 2058 participantes: más volumen da más ganancia, pero con rendimientos decrecientes claros.'
 WHERE id = 'pelland-2026' AND summary = '67 estudios y 2058 participantes: mas volumen da mas ganancia, pero con rendimientos decrecientes claros.';
UPDATE core_study SET summary = 'Cada serie semanal extra suma 0.37% de ganancia. De aquí sale la banda de 10 a 20 series por músculo por semana.'
 WHERE id = 'schoenfeld-2017' AND summary = 'Cada serie semanal extra suma 0.37% de ganancia. De aqui sale la banda de 10 a 20 series por musculo por semana.';
UPDATE core_study SET summary = '21 hombres entrenados, 8 semanas: 3 minutos de descanso ganaron más fuerza y más grosor de cuádriceps que 1 minuto.'
 WHERE id = 'schoenfeld-2016' AND summary = '21 hombres entrenados, 8 semanas: 3 minutos de descanso ganaron mas fuerza y mas grosor de cuadriceps que 1 minuto.';
UPDATE core_study SET summary = '13 estudios y más de 1100 participantes: entrenar una zona no baja la grasa de esa zona. No se puede elegir dónde adelgazar.'
 WHERE id = 'spot-review-2021' AND summary = '13 estudios y mas de 1100 participantes: entrenar una zona no baja la grasa de esa zona. No se puede elegir donde adelgazar.';
UPDATE core_study SET summary = '3 a 5 g al día saturan el músculo en 3 o 4 semanas sin fase de carga. Si dejas de tomarla, el lavado tarda de 4 a 8 semanas.'
 WHERE id = 'issn-creatine' AND summary = '3 a 5 g al dia saturan el musculo en 3 o 4 semanas sin fase de carga. Si dejas de tomarla, el lavado tarda de 4 a 8 semanas.';
UPDATE core_study SET summary = '34 artículos. Evidencia convincente de que una dieta de índice glucémico bajo reduce el acné; la de lácteos es mixta.'
 WHERE id = 'jaad-2022' AND summary = '34 articulos. Evidencia convincente de que una dieta de indice glucemico bajo reduce el acne; la de lacteos es mixta.';
UPDATE core_study SET summary = '26 estudios entre 2010 y 2025: carga glucémica alta, lácteos y proteína de suero asociados con acné. La vía sería insulina e IGF-1.'
 WHERE id = 'acne-patterns-2025' AND summary = '26 estudios entre 2010 y 2025: carga glucemica alta, lacteos y proteina de suero asociados con acne. La via seria insulina e IGF-1.';
UPDATE core_study SET summary = 'Para balancear: los estudios de lácteos se apoyan en recuerdos y tienen sesgo. Un ensayo doble ciego de seis meses con suero no dio el resultado esperado.'
 WHERE id = 'eadv-2024' AND summary = 'Para balancear: los estudios de lacteos se apoyan en recuerdos y tienen sesgo. Un ensayo doble ciego de seis meses con suero no dio el resultado esperado.';
UPDATE core_study SET summary = 'Agua total adecuada de 3.7 L al día para hombres de 19 a 50 años, y cerca del 20% viene de la comida. Las cifras no aplican a deportistas.'
 WHERE id = 'iom-2005' AND summary = 'Agua total adecuada de 3.7 L al dia para hombres de 19 a 50 anos, y cerca del 20% viene de la comida. Las cifras no aplican a deportistas.';
UPDATE core_study SET summary = '2.5 L al día solo de bebidas para hombres. Activo se suele necesitar de 3 a 4 L.'
 WHERE id = 'efsa-2010' AND summary = '2.5 L al dia solo de bebidas para hombres. Activo se suele necesitar de 3 a 4 L.';
UPDATE core_study SET summary = 'No bajó la testosterona; la síntesis testicular pareció unos 23% más alta. Implicaciones clínicas poco claras. Por eso se registra pero no se puntúa.'
 WHERE id = 'galmiche-2026' AND summary = 'No bajo la testosterona; la sintesis testicular parecio unos 23% mas alta. Implicaciones clinicas poco claras. Por eso se registra pero no se puntua.';
UPDATE core_study SET summary = '1449 pacientes de clínica del sueño: el uso diario por un año o más se asocia a más vigilia nocturna. Tu patrón está muy por debajo de esa exposición.'
 WHERE id = 'cannabis-sleep-2026' AND summary = '1449 pacientes de clinica del sueno: el uso diario por un ano o mas se asocia a mas vigilia nocturna. Tu patron esta muy por debajo de esa exposicion.';
UPDATE core_study SET summary = '96 voluntarios, 12 semanas: mediana de 66 días hasta que la conducta se vuelve automática, rango de 18 a 254. Saltarse una sola vez no afectó el hábito, y por eso el castigo por faltar es progresivo y no inmediato.'
 WHERE id = 'lally-2010' AND summary = '96 voluntarios, 12 semanas: mediana de 66 dias hasta que la conducta se vuelve automatica, rango de 18 a 254. Saltarse una sola vez no afecto el habito, y por eso el castigo por faltar es progresivo y no inmediato.';
UPDATE core_study SET summary = 'La carga de 20 g al día sube la creatina muscular un 20% en seis días, y 3 g al día llegan al mismo sitio en veintiocho. Dejándola, a los treinta días ya no se distingue del punto de partida. De aquí salen los dos extremos de la curva del depósito.'
 WHERE id = 'hultman-1996' AND summary = 'La carga de 20 g al dia sube la creatina muscular un 20% en seis dias, y 3 g al dia llegan al mismo sitio en veintiocho. Dejandola, a los treinta dias ya no se distingue del punto de partida. De aqui salen los dos extremos de la curva del deposito.';
UPDATE core_study SET summary = 'En este experimento, varios días con menos energía redujeron la síntesis muscular en reposo. El entrenamiento de fuerza y la proteína recuperaron la respuesta. Por eso quedar corto de calorías cuesta puntos de forma gradual, y entrenar sigue contando durante un déficit.'
 WHERE id = 'areta-2014' AND summary = 'En este experimento, varios dias con menos energia redujeron la sintesis muscular en reposo. El entrenamiento de fuerza y la proteina recuperaron la respuesta. Por eso quedar corto de calorias cuesta puntos de forma gradual, y entrenar sigue contando durante un deficit.';
UPDATE core_study SET summary = 'Al reunir ensayos de entrenamiento de fuerza, el déficit energético redujo la ganancia de masa magra, mientras que las ganancias de fuerza fueron comparables. Respalda que la curva de calorías baje al comer menos de la meta sin convertir cualquier déficit en cero puntos.'
 WHERE id = 'murphy-koehler-2022' AND summary = 'Al reunir ensayos de entrenamiento de fuerza, el deficit energetico redujo la ganancia de masa magra, mientras que las ganancias de fuerza fueron comparables. Respalda que la curva de calorias baje al comer menos de la meta sin convertir cualquier deficit en cero puntos.';
UPDATE nutrition_food SET name = 'Avena instantánea Quaker'
 WHERE id = 'oats-quaker' AND name = 'Avena instantanea Quaker';
UPDATE nutrition_food SET name = 'Sopa instantánea vegetal'
 WHERE id = 'chef-woo' AND name = 'Sopa instantanea vegetal';
UPDATE nutrition_food SET name = 'Pasta alta en proteína'
 WHERE id = 'catelli-pasta' AND name = 'Pasta alta en proteina';
UPDATE nutrition_food SET name = 'Latte proteico venti sin azúcar'
 WHERE id = 'starbucks-protein-latte' AND name = 'Latte proteico venti sin azucar';
UPDATE nutrition_food SET name = 'Barra de proteína'
 WHERE id = 'protein-bar-60g' AND name = 'Barra de proteina';
`;
