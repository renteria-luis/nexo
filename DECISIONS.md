# Decisions

Architectural decisions, oldest first. One entry per decision, appended in the session it was made.

## 2026-09-13 — Stack is Expo / React Native / TypeScript
Context: the owner has no Mac. Native iOS development would mean a GitHub Actions macOS runner round trip to see the result of every change, which makes iteration impractically slow. Builds are sideloaded onto his phone, never distributed.
Decision: Expo / React Native / TypeScript. Day-to-day development runs on his Linux machine with the app loaded on the phone over the network; macOS runners are needed only to produce signed builds.
Rejected: native Swift / SwiftUI, because every change would require a CI round trip and there is no local iOS toolchain. Flutter, because it adds a second language and buys nothing here.

## 2026-09-13 — Local-first storage, SQLite on device
Context: one user, one device, personal training and health data. The app has to work in a gym with no signal.
Decision: SQLite on the device is the system of record. Training and Nutrition data never leaves the phone. Tables are namespaced per module (training_*, nutrition_*, deals_*, finance_*) per the module contract in the spec.
Rejected: a hosted database or any sync layer, because it would force accounts, login and conflict resolution onto a single-user app. The Deals ingestion service is the one server-side exception and it holds no personal data, only vendor session tokens and a cache of public deals.

## 2026-09-13 — Repo is public, the spec stays out of it
Context: GitHub Actions macOS runner minutes are free for public repositories and expensive for private ones, and every build depends on those runners. The functional spec contains the owner's weight, body fat, sleep records, diet and other personal health details.
Decision: the repository is public. The spec file is listed in .gitignore, stays on the owner's machine only, and remains the source of truth locally. A PreToolUse hook blocks any attempt to write, stage or commit it, along with credential files and database dumps.
Rejected: a private repo, because the runner minutes would have to be paid for. Publishing a redacted spec, because a redaction maintained by hand eventually leaks something.

## 2026-09-13 — Finance is a module in this app, single user
Context: there is a separate specification for a personal finance app. Grocery spending is where the modules overlap: Finance knows what was actually spent, Nutrition knows the macros of what was logged, Deals knows what was on sale that week. Only one codebase can join those three. A free Apple ID also allows just three sideloaded apps.
Decision: Finance ships as a module inside this shell, under the same module contract as the others, and is single user like everything else here.
Rejected: a second standalone app, because protein per dollar against real spend becomes impossible to compute and a sideload slot is spent for nothing. Multi-user or shared finances, because that would force accounts, login and sync onto the entire platform to serve one module. Revisit as a scoped problem if it ever becomes real.

## 2026-09-13 — Attribution is stripped by a git hook, not by a setting
Context: CLAUDE.md forbids attribution of any kind in commit messages, PR titles and PR bodies. The attribution settings were already empty, yet a Claude-Session trailer still landed on all six setup commits. It is injected through the Bash tool description and does not honour those settings (known issue 77830). A setting that can be bypassed is not enforcement, which is the same reasoning that put the secret guard in a hook rather than in CLAUDE.md.
Decision: a commit-msg hook in .githooks/ strips any Claude-Session, Co-Authored-By: Claude or Generated with Claude Code line, along with the blank line it leaves behind, and core.hooksPath points at that directory. The attribution settings stay empty in the repo as a first line of defence. The six existing commits were rewritten to remove the trailer. PR bodies and titles go through the GitHub API rather than git, so no hook can reach them; CLAUDE.md now requires checking every PR body by hand before it is opened.
Rejected: trusting the attribution settings alone, because they were already set correctly and the trailer appeared anyway. Stripping the trailer by hand on each commit, because it depends on remembering. A pre-commit hook instead of commit-msg, because pre-commit cannot see or edit the message.

## 2026-09-13 — One PR is one commit on main, via squash merge
Context: the owner does not want the repository inflating his GitHub contribution graph. That graph counts commits on the default branch, so the nine granular setup commits registered as nine contributions on one day. Granular local commits are still wanted while working, because they are what makes a change reviewable and revertable.
Decision: work happens on a branch and lands on main through a GitHub squash merge, so one PR is exactly one commit. Local commits stay small and are never pre-squashed by hand. The nine setup commits already pushed were collapsed into a single root commit and force pushed, since that history was only ever local to this machine and nobody had pulled it.
Rejected: committing straight to main, which is what produced the problem. Rebase or merge commits on merge, because both carry every individual commit onto main. Writing fewer, larger local commits, because that trades reviewability for a cosmetic count.

## 2026-09-13 — Squash locally before pushing, and keep to a daily contribution budget
Context: supersedes the squash merge entry above, which was wrong about the cost. GitHub counts three separate things as contributions: every commit landed on the default branch, every pull request opened, and every pull request merged. Today's square reached eleven that way, nine pushed commits plus a PR opened plus a squash merge. The owner's objection was never to granular history, it was to the square being painted that dark.
Decision: the squash happens locally, before the push, not on GitHub at merge time. Work on a branch with small commits, collapse it to one, push that single commit to main. Pull requests are opened only when the owner asks for one, because a PR costs two contributions on top of the commit. The budget is a hard ceiling of 13 contributions a day and a target of 4 to 7; work that would exceed it gets reported rather than pushed.
Rejected: the branch plus PR plus squash merge flow, which is the industry default and the reason today hit eleven. Reducing the number of local commits instead, because that trades reviewability for a cosmetic count and the squash already solves it. Rewriting today's history to undo the eleven, because the owner explicitly chose to leave it.

## 2026-09-13 — Data layer shape for the spec section 5 entities
Context: SQLite has no array type and no decimal type, and the spec's entity list uses both. Six choices had to be made before any table could be written, and every one of them is expensive to reverse once there is data on the phone.
Decision:
1. Tables that belong to no single module take a `core_` prefix. `DailyLog` and `TargetSnapshot` mix sleep, steps, water, alcohol and weight, so they are `core_daily_log` and `core_target_snapshot`. Everything else keeps its module prefix, `training_` or `nutrition_`.
2. `Gym.machines` and `Exercise.gym_ids` are one relation, not two. A single `training_exercise_gym` table answers both questions and cannot contradict itself.
3. Muscles live in `training_exercise_muscle` with a `contribution` column, 1.0 for the primary muscle and 0.5 for a secondary one. Weekly set volume per muscle is a query, not a stored total, and the counts in spec section 13.2 are only correct if indirect work counts at half. The argument for adding direct forearm work in section 13.3 rests on those counts. Two triggers enforce that the 1.0 row is the exercise's primary muscle and that the primary muscle never appears as a secondary.
4. `sets_by_budget` is four columns, `sets_full`, `sets_minus_25`, `sets_minus_50` and `sets_express`, not JSON. The budgets are four and fixed by spec section 8.2, and NULL means the exercise is dropped at that budget, which is the dash in the section 8.4 tables.
5. Day-scoped dates are `TEXT` in `YYYY-MM-DD` in the owner's local timezone, checked by a GLOB pattern. Points in time are integer milliseconds since the Unix epoch in UTC. Money is an integer count of cents, `price_cad_cents`.
Rejected: JSON columns for the array fields, because weekly volume per muscle has to be aggregated in SQL and JSON cannot be. Storing money as REAL, because rounding error accumulates and the protein per dollar comparison in spec section 16.6 depends on it not doing that. Storing dates as epoch milliseconds only, because a day boundary is a local calendar fact and converting on every read invites off-by-one days. A single `muscle_role` enum instead of a numeric contribution, because the scoring code would then carry the 1.0 and 0.5 constants instead of the data carrying them.

## 2026-09-16 — Apple Health y AutoSleep quedan en espera hasta que haya cuenta de pago
Context: El dueño quiere que el sueño entre solo, sin escribirlo. AutoSleep escribe en
Apple Health, así que leer Health cubre ambos. Su condición fue construirlo solo si no
exige la cuenta de 99 dólares al año.
Decision: En espera. La tabla oficial de capacidades de Apple da HealthKit al Apple
Developer Program y al Enterprise Program, y lo deja en blanco para la cuenta gratuita,
así que la lectura de Health no se puede firmar sin pagar. No se agregó dependencia ni
código: nada a medias esperando en el repositorio.
Rejected: Construirlo igual y dejarlo apagado. Arrastraría una dependencia nativa que
además impide correr en Expo Go, que es como él usa la app hoy.

## 2026-09-16 — La ubicación se lee una sola vez y solo cuando él la pide
Context: Detectar el gimnasio al llegar (spec 5.2) sin que el GPS quede encendido.
Decision: Un botón "usar mi ubicación" en la pantalla de empezar entreno, junto a los
dos gimnasios. Una sola lectura de alta precisión con permiso en uso, sin vigilancia ni
permiso de segundo plano: la lectura termina y la radio se apaga sola.
Rejected: Geocerca en segundo plano. Detectaría la llegada sin tocar nada, pero pide el
permiso "siempre" y mantiene el servicio despierto, que es justo lo que no quiere.

## 2026-09-24 — La nota del día pasa a ser absoluta sobre 100
Context: Pedía que un solo criterio bastara para tener nota, porque anotar algo ya
prueba que no se olvidó de entrar. Con la fórmula anterior, que dividía solo entre los
criterios con dato, un día de pura creatina habría dado 100 y alargado la racha.
Decision: La nota es la suma de los puntos ganados sobre los 100 del día. Un criterio
sin dato no gana nada y cuesta su peso, así que un solo criterio da exactamente lo que
vale ese criterio. Basta uno para tener nota; con cero, gris. Sus tres días reales
pasaron de 83 a 76, de 66 a 66 y de 54 a 30: con el día completo las dos fórmulas
coinciden y solo se separan donde hay huecos.
Rejected: Dejar el mínimo en 3 y pintar el cuadrito sin número. Pintaba el día pero no
le daba la nota que pidió. También rechazado subir el peso de la creatina a 10 o 15:
los pesos de §4.1 salen de la evidencia y eso la pondría por encima del agua y de los
pasos.

## 2026-09-24 — Un descanso marcado con la semana cumplida vale como entrenar
Context: Con la nota absoluta, no entrenar cuesta los 22 puntos del criterio, así que
un día de descanso perfecto topaba en 78 y descansar penalizaba.
Decision: Si los últimos siete días ya tienen las cinco sesiones de §4.3 y marca
"descanso", el criterio de entreno se gana entero. Con sesiones pendientes no se gana.
Rejected: Sacar el entreno del total ese día y repartir los 22 entre los demás. Cambia
lo que vale cada criterio según el día y vuelve incomparables dos notas iguales.

## 2026-09-24 — La semana de un descanso mira hacia adelante, no solo hacia atrás
Context: Marcó descanso un jueves con dos entrenos detrás y tres por delante. La
ventana de siete días hacia atrás decía 2 sesiones y le negaba los 22 puntos por una
semana que todavía no había pasado.
Decision: Un descanso marcado gana los puntos si cualquier ventana de siete días que
contenga ese día llega a cinco sesiones. El día queda provisional hasta que su semana
cierra, y los últimos siete días se vuelven a puntuar en cada arranque.
Rejected: Semana fija de lunes a domingo. Rompe el "rolling, not pinned to weekdays"
de §4.3 y castiga al que mueve un entreno de domingo a lunes.

## 2026-09-25 — El sueño, la proteína y las calorías se puntúan con curvas
Context: Una noche corta por trabajo le dio 0 de 20, igual que si no hubiera
dormido nada. El umbral de §3.5 (cero por debajo de 6 h) no dice lo que dice la
evidencia, y lo mismo pasaba con la proteína y las calorías, que eran bandas con
acantilado.
Decision: Tres criterios pasan a leerse de una curva de puntos con rectas entre
ellos. La del sueño es la escala que él escribió a partir de Saner 2020, con los 20
puntos en las 8 h; una noche corta ya no vale cero. La de proteína sigue la meseta de Morton
2018 (1.62 g/kg, IC 1.03-2.20). La de calorías se ancla en Areta 2014 (diez días al
80% bajan la síntesis 16%) y baja más suave por arriba, donde se gana grasa pero no
se pierde músculo. Cada criterio guarda sus decimales y la nota del día también:
un decimal, sin redondear. Un 99.2 se queda en 99.2, porque redondeando hacia arriba
un día casi perfecto salía como cien.
Rejected: Ajustar la curva del sueño a su meta personal de 7 h. La escala que eligió
es absoluta y da 17 de 20 a las 7 h; escalarla a su meta habría deformado los puntos
que él fijó. Su meta de Ajustes se queda como referencia y para los avisos.

## 2026-09-25 — Los avisos se deciden en el teléfono y se aprenden de él
Context: Quería que la app le avise lo que falta sin volverse fastidiosa, con tope de
3 al día y los cuatro tipos.
Decision: El motor que decide vive en core y no habla con iOS, así que se prueba
entero sin teléfono. Las horas salen de la mediana de lo que ya anota (comida por
espacio, inicio de sesión, primer rastro del día), con el horario de §1.4 hasta tener
cinco muestras. Se programan 3 días por delante porque iOS no deja pensar en segundo
plano, y el plan se rehace en cada carga de la app.
Rejected: Horas fijas configurables a mano, como MyFitnessPal. Obliga a mantenerlas
él y envejecen mal. También rechazado un servidor que decida y empuje: la app es
local y sin cuentas.

## 2026-09-25 — El agua, los pasos y las calorías tampoco tienen escalón
Context: 2.23 L de una meta de 2.8 L daban 1.5 de 8, y 1 180 kcal daban 0 de 10. El
mismo problema del sueño: un umbral con cero debajo dice que media meta es lo mismo
que nada.
Decision: Los tres pasan a curvas casi proporcionales. El agua llega a cero solo en
cero, con caída algo más rápida en la mitad de abajo, porque la deshidratación empeora
de forma continua desde ~2% del peso corporal. Las calorías igual, con las dos caras
costando casi lo mismo a la misma distancia (Areta 2014, Murphy 2022, Garthe 2011) y
el déficit un pelo mejor tratado porque va hacia la meta de bajar grasa.
Rejected: Dejar los pasos como estaban. No los mencionó, pero tenían el mismo escalón
al 70% y habría vuelto a salir.

## 2026-09-25 — Borrar un alimento que ya comió lo archiva, no lo borra
Context: Pidió poder borrar alimentos. Borrar uno que tiene porciones anotadas
reescribiría los totales de esos días, y un día que ya pasó no se toca.
Decision: Si nunca lo comió se borra de verdad, que es el caso del error de tecleo.
Si tiene porciones o tandas, se archiva: desaparece de donde elige y de donde corrige,
sus días siguen diciendo lo mismo, y se recupera desde "ver archivados". El aviso en
pantalla dice cuál de las dos cosas pasó.
Rejected: Borrar en cascada las porciones. Es la forma más rápida de perder semanas de
registro por un toque.

## 2026-09-26 — Los 22 puntos del entreno dejan de ser un interruptor
Context: Una serie de press inclinado ya marcaba 22/22, igual que la sesión entera.
Decision: La nota del entreno es 0.75 × (series ponderadas hechas / planeadas) +
0.25 × (músculos tocados / músculos del plan). Las series se ponderan con las
contribuciones que cada ejercicio ya tenía en el catálogo (1.0 al primario, 0.5 a los
secundarios), así que un compuesto vale más que un aislamiento sin tener que decirlo a
mano. Sin plan, el denominador es una sesión de referencia de 24 series ponderadas.
Rejected: Meter el volumen levantado como multiplicador. Su propia readaptación de
§6.5 entrena al 70% de la carga a propósito, y eso saldría como un día malo.

## 2026-09-26 — Borrar un alimento que ya comió lo archiva; terminar un entreno se deshace
Context: Tocó "terminar entreno" sin querer a mitad de la sesión y no había vuelta
atrás; el reloj además seguía corriendo con la sesión cerrada.
Decision: Un botón "seguir entrenando" que borra la hora de fin y deja la sesión como
estaba, y el reloj se para en lo que duró. Es el único botón de la sesión sin vuelta
atrás; el resto ya se deshacen quitando la serie.

## 2026-09-26 — El plan elige la variante del ejercicio según el gimnasio
Context: En Fit4Less el plan salía con las laterales en polea aunque ahí está la
máquina Nautilus, que las recomendaciones ponen como primera opción.
Decision: Una tabla de variantes con rango (máquina 1, polea 2, mancuerna la base) y
el plan se queda con la mejor que exista en el gimnasio de esa sesión. Sin gimnasio
elegido manda lo que diga la rutina.
Rejected: Una columna por gimnasio en la rutina. No escala y repite la misma pregunta
para cada máquina nueva.

## 2026-09-26 — Fuera el modo oscuro, y la racha se cuenta por calendario
Context: El modo oscuro recién hecho se veía mal, y el rediseño todavía está a medias
en modo claro. Aparte, preguntó qué cuenta como día de racha y resultó que la cuenta
saltaba los huecos: un día sin nada anotado no rompía nada porque no estaba en la lista.
Decision: Quitar el modo oscuro de raíz (una sola paleta, sin ajuste de apariencia) y
volver a mirarlo cuando el modo claro esté terminado. Y contar la racha sobre el
calendario: un día sin nota o por debajo de 70 corta, hoy suma cuando pasa de 70 y
mientras no llega no corta, y rellenar un día viejo vuelve a unir la racha.
Rejected: Dejar el modo oscuro escondido detrás de un ajuste. Media pantalla sin
terminar en dos paletas es el doble de trabajo por cada pantalla que falta.

## 2026-09-26 — El orden del plan mueve el selector de ejercicios
Context: Dentro del entreno la lista está en orden alfabético (bien, así se busca por
nombre), pero entonces tenía que acordarse de cuál puso segundo en el plan y leerlos uno
por uno entre serie y serie.
Decision: El orden en que aparecen los ejercicios al aprobar el plan es el orden en que
piensa hacerlos. Al empezar se abre el primero, y al completar las series planeadas de
uno se abre solo el siguiente que le falte, dando la vuelta para recoger el que se saltó
por una máquina ocupada. No escribe nada ni entra en ninguna cuenta, y se puede seguir
eligiendo a mano.
Rejected: Ordenar la lista del entreno por el plan. Buscar un ejercicio concreto se hace
por nombre, y con el orden del plan hay que recorrerla entera.

## 2026-09-26 — El orden de hoy se cambia arrastrando, antes de empezar
Context: Pidió poder mover los ejercicios del plan antes de darle empezar, y él mismo
propuso mantener apretado un par de cientos de milisegundos para despegar la fila.
Decision: Arrastre con el PanResponder de siempre, hold de 250 ms para despegar, la fila
sigue al dedo y las otras se abren para hacerle sitio; al soltar se renumeran las
posiciones guardadas. Mientras hay una fila despegada la pantalla no se desplaza.
Rejected: Flechas de subir y bajar por fila (más simple y sin gestos, pero mover el
séptimo al primer sitio son seis toques) y una librería de arrastre (todas piden
Reanimated, que es lo que tumbó la app el 21 de septiembre).

## 2026-09-26 — El marco de la app lo dibujamos nosotros, no el sistema
Context: La barra de abajo era la que trae React Navigation y pintaba el icono y la
palabra de la pestaña abierta en amarillo, que sobre papel casi no se ve: la única señal
de dónde estaba parado era una rayita de cuatro puntos. Y el encabezado de arriba es
nativo: solo deja cambiarle el color, no acepta el borde de tinta ni un botón con
relieve, y ponía su propio fondo redondo debajo del nuestro.
Decision: Barra de pestañas propia (`src/ui/TabBar.tsx`) con un bloque amarillo con borde
y sombra que se desliza pegado al carrusel, y barra de arriba propia
(`src/ui/TopBar.tsx`) con el nombre en una pegatina plana y Ajustes como botón con
relieve. El encabezado nativo se apaga solo en la pantalla principal; las pantallas
apiladas lo siguen usando, porque ahí el gesto de volver y el título son suyos.
Rejected: Seguir peleando con las opciones del encabezado nativo (no llegan al borde ni
al relieve) y apagarlo en toda la app (habría que rehacer el botón de volver y el título
en las doce pantallas apiladas, y perder el gesto tal como lo pinta iOS).

## 2026-09-27 — Comer bien deja de restar nota
Context: Un día comió proteína muy por encima de la meseta y la nota le puso 14.5 de 16. La curva
bajaba pasada la meseta de Morton porque la proteína de más no aporta y le quita sitio a
los otros macros. La cuadrícula acabó castigando un día de comer bien, que es lo
contrario de lo que tiene que enseñarle.
Decision: La proteína por encima de la banda no resta: la curva llega a 1 en 1.8 g/kg y
se queda ahí. Y las calorías dejan de tener curva por arriba: mil calorías por encima
del piso de la banda no cuestan nada, y a partir de ahí un punto de los diez por cada
doscientas. Por debajo todo sigue igual, porque quedarse corto sí compromete las
metas 1 a 3 ese mismo día. Migración 044 borra las notas guardadas para que se rehagan.
Rejected: Dejar las dos caras en la misma curva (era lo que había: simétrico y barato de
explicar, pero trata igual engordar despacio que dejar de comer) y quitarle todo el
castigo a las calorías (no quiere engordar, y entonces el criterio no diría nada).

## 2026-09-27 — El teclado vuelve a ser el de Apple
Context: La app tenía teclado propio de números desde el principio y de letras desde hoy.
Probándolos: "funciona bien, lo único que no me convence es que no es tan smooth ni tan
rápido como el de Apple... prefiero eficiencia a estética porque los teclados casi no los
abriré". Y un teclado de letras propio se lleva por delante el autocorrector, el dictado,
las tildes, escribir deslizando y la accesibilidad, que no tienen API: hay que rehacerlas
a mano.
Decision: Los campos usan el teclado de iOS, con `keyboardType` según lo que se escriba.
Lo nuestro se queda en lo de alrededor, que es lo que sí valía: el contenido sube para
que el teclado no tape el campo (ahora con el alto y la duración que el propio sistema
avisa, así que va más pegado que antes), deslizar hacia abajo lo cierra, tocar fuera lo
cierra, y encima del teclado va nuestra barra (`InputAccessoryView`, que viene en React
Native) con la tecla de listo, que el teclado de números de Apple no trae. Se borran
`NumberPad`, `TextPad` y `NumberPadHost`: 1287 líneas que siguen en el historial.
Rejected: `react-native-keyboard-controller`, que es lo que recomienda la documentación
de Expo, porque su 1.22.5 exige `react-native-reanimated` >= 3 y Reanimated es lo que
tumbó la app el 21 de septiembre; todo lo que de ahí necesitábamos está en el núcleo de
React Native. Y quedarnos con el teclado numérico propio, que era defendible, pero deja
vivos dos mecanismos a la vez (nuestro alto medido y los avisos del sistema), que es
justo donde han estado los fallos de estos días.

## 2026-09-27 — Las ofertas dicen el kilo y el gramo de proteína, o no valen nada
Context: "hasta ahora me resulta inútil y es más fácil abrir la app de Flipp
directamente". Tenía razón y los números lo decían: de 224 ofertas de un día, 113 no
traían unidad ninguna y solo dos traían una que el código entendía, así que la proteína
por dólar salía vacía en casi todas. Y el botón de abrir mandaba al navegador, porque
iOS solo contesta `canOpenURL` por los esquemas declarados en el Info.plist propio.
Decision: El recolector pide la ficha de cada artículo, lee el peso del título y el
precio por kilo de la letra chica, y lo guarda (migración 045). Con eso, 305 de 418
ofertas tienen peso y la pantalla puede decir el precio por kilo y los gramos de
proteína por dólar, que es lo único que Flipp no puede decir. El botón usa
`https://flipp.com/action/item/<id>`, que es un enlace universal declarado por
flipp.com: abre la app en ese artículo, y la web solo si no está instalada. La lista se
agrupa por producto, por tienda, o se ordena por valor.
Rejected: Seguir con el esquema `flipp://` (no funciona sin declararlo, y el enlace
universal hace lo mismo mejor) y adivinar el peso cuando no está escrito (spec 16.3
regla 5: un hueco se muestra, no se rellena).

## 2026-09-28 — Ofertas sale del menú y se convierte en un aviso
Context: "hasta ahora me resulta inútil y es más fácil abrir la app de Flipp
directamente". Una pantalla con cuatrocientas tarjetas es una lista que hay que
recorrer; lo que él quiere saber es "¿hay algo de lo mío en oferta?". Y la barra de
abajo tenía dos pestañas gastadas en Ofertas y en un módulo que todavía no existe.
Decision: Ofertas deja de ser pestaña. Se vigila una lista de palabras suyas
(`deal_watchlist`, separadas por coma, en Ajustes) y, cuando hay recolección nueva con
coincidencias, al abrir la app sale una hoja con qué está en oferta, en qué tienda, a
cuánto la medida y hasta cuándo. Esa misma hoja se reabre desde la cartilla de Hoy, y
"Ver todas" lleva a la lista completa, que sigue existiendo como pantalla apilada. La
búsqueda es por trozo de palabra, sin tildes ni mayúsculas, sobre el nombre y la letra
chica: de más antes que de menos, por decisión suya.
Rejected: Dejar la pestaña (gasta un sitio de la barra en algo que mira una vez por
semana) y buscar por palabra exacta (perdería "EGGS" al escribir "egg", que es
justamente lo que no quiere).

## 2026-09-28 — Un menú lateral, y la barra de abajo se queda con tres
Context: Ofertas y Finanzas salieron de la barra de abajo, y varias pantallas que ya
existen (Registros, Resumen semanal, Gráficas, los dos catálogos, Lecturas,
Recomendaciones, Experimentos) solo se abrían desde una cartilla suelta o desde Ajustes.
Hacía falta un sitio donde esté todo sin gastar la barra, y hace falta sitio para la
despensa y el asistente que vienen después.
Decision: Un menú lateral escrito a mano (`src/ui/Sidebar.tsx`), agrupado en Día a día,
Historial, Catálogo, Ofertas y Saber, con Finanzas y Ajustes en el pie. Se abre con las
tres rayas del encabezado, vive fuera del navegador para quedar encima de todo, y navega
por el ref del contenedor. La barra de abajo se queda con Hoy, Entreno y Comida, que es
lo que usa a diario.
Rejected: `@react-navigation/drawer`, que exige `react-native-reanimated` (la librería
que tumbó la app el 21 de septiembre), y meter más pestañas abajo, que era el problema.

## 2026-09-28 — El asistente reemplaza la linea de comandos, y pregunta antes de tocar otro dia
Context: La linea de comandos vivia en una cartilla de Hoy y solo escribia en hoy. El
quiere hablarle a la bola desde donde este, decirle "25 set pasos 5000", y que lo que se
habla no se pierda.
Decision: La bola abre un chat (`src/ui/Chat.tsx`). Entiende los mismos comandos de
siempre mas la fecha, delante o detras, en las formas que el escribe (`ayer`, `25 set`,
`25/09`, `2025-09-25`); sin anio se asume el de hoy y, si eso cayera en el futuro, el
anterior. Escribir en un dia que no es hoy pide confirmacion y dice que hay ahora en ese
dia. Cada chat se guarda entero en SQLite y abrir uno nuevo no borra el anterior. La
`CommandBar` se borro: hacia lo mismo en menos sitios.
Rejected: Dejar las dos (dos caminos para lo mismo que se separan en la siguiente
version) y escribir en cualquier dia sin preguntar (corregir hoy se ve al momento; pisar
un martes de hace tres semanas no se nota hasta que la cuadricula cambia de color).

## 2026-09-28 — El peso escrito al asistente se convierte segun su unidad
Context: La linea de comandos guardaba "peso 74.2" como 74.2 kg aunque el ajuste
estuviera en libras, mientras que la serie si convertia. Una de las dos estaba mal.
Decision: El asistente convierte con `toKg` igual que la serie, asi que en libras "peso
165" guarda 74.8 kg. Si el escribe siempre en kilos no cambia nada.
Rejected: Copiar el comportamiento anterior tal cual, que guardaba libras como kilos.

## 2026-09-29 — El modelo vive en el telefono, y solo traduce
Context: El asistente entendia comandos pero no frases. El quiere hablarle normal ("ayer
dormi como seis y media") y que ademas conteste cosas suyas ("cual fue mi mejor marca"),
y que sea gratis.
Decision: Apple Foundation Models dentro del telefono (`@react-native-ai/apple`, iOS 26,
su iPhone). Gratis, sin cuenta, sin limite y sin conexion. El modelo no
escribe nunca: se le pide un objeto con esquema y lo unico que puede proponer es una
linea de la misma gramatica de comandos, que vuelve a pasar por el parser; todo lo que
proponga se confirma antes de escribirse. Las preguntas son cuatro y las contesta la app
desde SQLite, no el modelo. Se usa solo el modulo nativo, no el envoltorio del paquete,
que arrastra el SDK de Vercel y zod al bundle y revienta al importarse si no esta
compilado.
Rejected: RAG (su informacion es pequena, local y relacional: una consulta exacta gana a
recuperar texto), texto libre en vez de esquema, y la nube por defecto, que queda como
respaldo explicito para cuando el modelo del telefono se quede corto.

## 2026-09-29 — Palabras que ignorar en las ofertas
Context: Buscar dentro de la palabra es generoso en las dos direcciones. Vigilar "milk"
traia leche condensada, de coco, con chocolate, de avena, chocolate con leche y la de
biberon para perros: 126 coincidencias en un dia de 408 ofertas.
Decision: Una segunda lista en Ajustes (`deal_blocklist`), con el mismo formato. Una
oferta que coincida con una palabra vigilada y tambien con una excluida no sale. Lo que
trae de fabrica se eligio midiendo sobre un dia real: 126 pasan a 87 sin perder ninguna
oferta de lo que si come.
Rejected: Afinar la busqueda (perderia "EGGS" al escribir "egg", que es justo lo que el
pidio que no pasara) y excluir "breaded" o "pasta", que si son comida suya.

## 2026-09-30 — La despensa dice lo ultimo que el escribio, y no se descuenta sola
Context: Fase 4, spec 21. Una despensa que se descuenta cuando come acaba en ficcion en
una semana, porque cocina de paquetes que la app nunca vio y come cosas que nunca anoto.
Decision: Cuatro formas de tener algo, que son las que hay en su nevera: contado,
pesado, duradero (`hay` / `poco` / `no hay`) y especia (si o no). Lo duradero y las
especias no llevan cantidad a proposito: no va a pesar un cacito de whey, y pedirle
gramos ahi garantiza que el numero este mal. Lo unico que descuenta solo es cocinar una
receta, y solo lo que se midio.
Rejected: Pedir gramos de todo (un numero exacto inventado es peor que uno grueso
verdadero) y descontar al comer una porcion.

## 2026-09-30 — Cocinar una receta crea un alimento suyo, invisible en el catalogo
Context: Spec 21.4 dice que cocinar deja un lote (spec 7.3), y un lote necesita un
alimento del que tirar. Una olla de pollo con arroz no es ninguno de los alimentos del
catalogo.
Decision: Cocinar crea o actualiza un alimento por receta (`recipe-<id>`) con las cifras
por gramo que salen de sus ingredientes, marcado con `from_recipe`, y el lote cuelga de
el. Ese alimento no sale ni en el catalogo ni en el buscador: la forma de anotar una olla
es su porcion, de un toque. Si algun ingrediente medido no tiene ficha con peso, se
descuenta la despensa igual pero no hay lote, y la pantalla dice cual lo impidio.
Rejected: Una tabla de macros propia del recetario (dos verdades que se separan) y
adivinar el peso de lo que no tiene ficha (spec 16.3 regla 5).

## 2026-09-30 — Las ofertas se pliegan por grupo, y empiezan cerradas
Context: "por producto" dejaba veinte grupos abiertos y habia que deslizar media
pantalla para llegar al siguiente producto.
Decision: Cada grupo, de producto o de tienda, es una cabecera con su cuenta y un
chevron. Cerrados de entrada: la cuenta ya dice si vale la pena abrirlo.
Rejected: Dejarlos abiertos y confiar en el desplazamiento, y limitar cuantas ofertas
muestra cada grupo (esconder ofertas es lo contrario de lo que pidio: prefiere ver de
mas).

## 2026-09-30 — Leer primero, escribir con el lapiz
Context: Cada cartilla traia todos sus botones puestos, y leer el registro del dia, las
series de un ejercicio o lo comido era deslizar entre botones que no estaba usando.
Decision: Un lapiz en la cabecera de esas tres cartillas. Apagado, la cartilla es una
lista compacta de una linea por dato; encendido, aparecen los campos, los botones de
anotar y las papeleras. Borrar ademas pregunta en un globito pegado al boton.
Rejected: Dejarlo todo visible (lo que habia) y esconder solo las papeleras, que era la
mitad del ruido.

## 2026-09-30 — Arriba va la fecha de hoy, no el nombre de la app
Context: El nombre de la app ocupaba la barra de todas las pantallas y el ya sabe que app
abrio.
Decision: En su sitio va "viernes, 30 de setiembre". En un dia suelto no va nada, porque
ahi la fecha que importa es la del dia abierto, que va en el titulo con flechas al dia
anterior y al siguiente. El nombre se queda en el menu lateral.
Rejected: Dejar el nombre, y poner la fecha ademas del nombre (dos cosas en una barra que
solo tiene sitio para una).

## 2026-09-30 — La banda de calorias sube 400 y la de proteina no tiene techo
Context: Comer de mas en proteina o en calorias salia pintado como fuera de banda, y lo
que le pasa a el es quedarse corto, no pasarse.
Decision: La banda de calorias va de la meta menos 150 a la meta mas 550. La de proteina
se pinta con suelo y sin techo, como la de sueno y la de pasos, y el desglose del dia dice
"N g o mas" en vez de "N a M". Lo que si engorda lo sigue cobrando la regla de las
mil calorias libres (spec 4.1), que empieza mucho mas arriba.
Rejected: Tocar las curvas de puntos, que ya no penalizaban ninguna de las dos cosas: lo
que estaba mal era lo que se pintaba, no lo que se puntuaba.

## 2026-09-30 — El lapiz es de los registros, no de hoy
Context: Se puso el modo lectura tambien en Hoy y en la pestana de Comida, y ahi estorba:
son las dos pantallas que esta escribiendo todo el dia.
Decision: El lapiz vive en un dia abierto desde Registros y en la cartilla del ejercicio
durante el entreno. Hoy y Comida se quedan como estaban, con todo a la vista. Los
componentes son los mismos en las dos pantallas, asi que llevan el modo por prop
(`editing` en `TodayLog`, `record` en `FoodLog`) en lugar de decidirlo por su cuenta.
Rejected: Duplicar los componentes para que cada pantalla tenga el suyo, que es como se
acaba con dos comportamientos que se separan solos.

## 2026-09-30 — La paleta pasa a pastel
Context: Los cinco colores planos del neobrutalismo, a plena saturacion, en una pantalla
entera de cartillas: cansa.
Decision: Los mismos cinco tonos con la saturacion bajada y el brillo subido, y un sexto
tono calido (`surfaceWarm`) para la isla de abajo, que era blanca. La tinta sigue siendo
negra encima de todos, que es lo que mantiene el contraste. Las paletas de la cuadricula
(spec 4.5) no se tocan: no son decoracion, son la escala que le deja leer la nota, y
suavizarlas la romperia.
Rejected: Cambiar solo el amarillo (el resto seguiria gritando) y bajar tambien la
cuadricula.

## 2026-09-30 — El respaldo roto se cae entero, no a medias
Context: Al restaurar, la comprobacion de referencias se hacia despues de confirmar la
transaccion: un respaldo viejo encima de datos nuevos avisaba de "referencias rotas"
cuando ya las habia escrito, y el telefono se quedaba en ese estado.
Decision: La comprobacion entra dentro de la transaccion, asi que un respaldo que dejaria
algo colgando no se aplica y el telefono se queda con lo que tenia. El mensaje dice en
que tabla.
Rejected: Encender las claves foraneas durante la carga (las tablas se escriben en orden
alfabetico y una sesion entra antes que su gimnasio) y arreglar las filas colgantes a
mano al vuelo, que es decidir por el que se borra.

## 2026-09-30 — El tiempo de una sesion dice si vale
Context: Quiere ver, antes de empezar, cuanto suele tardar un dia como el de hoy, y a que
hora va a salir. Pero unos dias cierra el entreno al salir del gym y otros en casa, y un
promedio con esos dos mezclados no dice nada.
Decision: Cada sesion lleva `duration_trusted` (migracion 050) y solo las marcadas entran
en el promedio y en la grafica de tiempo. El interruptor y el ajuste de horas y minutos
estan en el registro de ese dia. Lo ya guardado entra marcado si dura entre veinte
minutos y cuatro horas, que es un punto de partida, no una afirmacion.
Es la mediana y no la media, como las horas aprendidas de spec 18.2: con cuatro sesiones,
el dia que se quedo charlando mueve la media veinte minutos y la mediana nada. Se dice
por tipo de dia (misma rutina, mismo gym, mismo recorte) porque son duraciones
distintas, y sin ninguna sesion de fiar de ese tipo no se muestra nada.
Rejected: Guardar los minutos aparte (dos numeros que pueden decir cosas distintas; se
mueve la hora de salida) y estimar lo que le queda por los ejercicios que faltan, que es
otro problema y el pidio solo el tiempo.

## 2026-09-30 — Una sola pantalla rota, y es la del descanso
Context: Entre serie y serie el telefono esta apoyado en la maquina y lo unico que hace
falta mirar es el reloj del descanso.
Decision: Con `expo-screen-orientation`, la app sigue de pie en todas partes y solo la
pantalla de entreno, con una sesion abierta, permite girar. De lado se ve otra cosa: el
descanso en grande, el ejercicio y la serie anterior, y nada que tocar.
Rejected: Permitir el giro en toda la app (las cartillas se estiran y ninguna otra
pantalla gana nada) y meter el reloj grande en la vertical, donde compite con los campos.

## 2026-09-30 — El boton de abrir en Flipp se quita
Context: Sigue abriendo Safari. El enlace de `/action` es universal y Flipp lo declara,
pero quien decide si va a la app o al navegador es iOS, y una vez que ha ido a Safari se
queda yendo; desde la app no hay forma de forzarlo.
Decision: Fuera el boton. Cada oferta ya lleva la insignia de su fuente, que es lo que
hacia falta de verdad para distinguir Flipp de Flashfood cuando entre.
Rejected: Dejarlo (un boton que promete abrir una app y abre el navegador miente) y
probar `flipp://`, que no esta declarado y no hace nada.

## 2026-10-01 — El progreso de un ejercicio se mira con un selector, no con dos capas
Context: La grafica llevaba barras de volumen y encima una linea de 1RM, y la linea no se
podia tocar: la barra se queda con el dedo.
Decision: Un segundo selector que elige que se mide, y una sola serie de barras. Seis
medidas, porque cada una contesta algo distinto: volumen (el trabajo del dia), peso
maximo (el numero que escribio, con mancuernas el de una), 1RM estimado (compara dias con
repeticiones distintas), peso medio por repeticion (pesado contra largo), repeticiones y
series. El volumen cuenta las dos mancuernas, como en toda la app; el peso maximo no,
porque es lo que lee en el disco.
Rejected: Hacer tocable la linea por encima de las barras (dos zonas de toque pisadas en
el mismo sitio) y dejar una sola medida, que era lo que habia.

## 2026-10-01 — La creatina se mira como un deposito, no como un si o un no
Context: La cuadricula dice si la tomo cada dia, y eso no contesta lo que el quiere
saber: si ya le esta haciendo efecto, y cuanto le cuesta saltarse un dia o dos.
Decision: Una grafica del deposito, de 0 a 100%, estimada dia a dia. Los dos extremos son
medidos (Hultman 1996, que entra en Lecturas con la migracion 051): 3 g al dia llenan en
28 dias, y dejandola se vacia en 30. Entre medias, sube como un deposito que se satura
(cada dia entra una parte de lo que falta, porque el transporte al musculo se satura) y
baja en linea recta (cada dia se pierde lo mismo, porque lo que sale es el desgaste
normal y no sabe cuanto queda). Un dia sin anotar cuenta como no tomada, que es la
lectura conservadora.
Rejected: Pintar solo si la tomo o no (es lo que ya hace la cuadricula y no dice nada del
efecto) y suponer que los dias sin anotar si la tomo, que es prometerle un efecto con
dias que nadie registro.

## 2026-10-02 — Un descanso y el fin de la readaptacion reinician la racha de faltas
Context: La auditoria del 1 de octubre encontro dos casos que spec 4.3 no resolvia. Un
descanso marcado con sesiones pendientes contaba como una falta mas, asi que la falta del
dia siguiente salia como la segunda (-18) y no como la primera (-8). Y las faltas durante
la readaptacion no restaban, pero seguian sumando a la racha, que al terminar volvia ya
escalada.
Decision: Un descanso marcado corta la racha igual que una sesion, gane o no sus 22
puntos: la falta siguiente es la primera. Las faltas dentro de la readaptacion no cuentan
para la racha, asi que al terminar empieza de cero.
Rejected: Contar el descanso como una falta mas y arrastrar la racha a traves de la
readaptacion, que es lo que hacia el codigo.

## 2026-10-02 — La nota se corta en un decimal, y un dia pasado sin nada queda en blanco
Context: Dos sitios donde el numero del dia decia otra cosa que la cuadricula. La nota se
redondeaba a un decimal, asi que un 99.96 salia como 100. Y un dia pasado sin nada anotado
salia gris en la cuadricula pero con un 0 en su globito y en su pantalla, porque cuando el
dia ya paso, no haber entrenado cuenta como dato.
Decision: La nota se corta en un decimal y nunca se redondea: 100 es solo un dia perfecto.
Se guarda con ese decimal, para que la cuadricula, la racha, Registros y las graficas lean
el mismo numero que la pantalla del dia. Un dia pasado sin sesion y sin nada anotado no
tiene nota y sale en blanco en todas partes; la falta sigue contando para la racha de spec
4.3. Precisa el "un decimal, sin redondear" del 2026-09-25.
Rejected: Redondear a un decimal, que es lo que hacia el codigo, y mostrar el 0, que
contradice el gris de la cuadricula.

## 2026-10-02 — La banda semanal de series cuenta solo las directas
Context: El resumen semanal marca cada musculo como bajo, en o sobre la banda de 10 a 20
series. El codigo la mide con las series directas, y el punto 3 del 2026-09-13 dice que las
cuentas de spec 13.2 solo cuadran con el trabajo indirecto a mitad.
Decision: La etiqueta de la banda cuenta solo series directas. Las ponderadas (un musculo
secundario vale media serie) se siguen mostrando al lado y siguen pesando en los 22 puntos
del entreno (2026-09-26), pero no mueven la etiqueta. Para la banda deja de valer lo que
decia el punto 3 del 2026-09-13; la tabla de contribuciones se queda como esta.
Rejected: Contar el trabajo indirecto a mitad en la banda.

## 2026-10-02 — Creatina: el deposito en Graficas y "resaturando" en Hoy
Context: Spec 1.3 pedia una nota de "resaturando" junto al criterio de la creatina, y el
2026-10-01 trajo la grafica del deposito; la auditoria pregunto si una reemplazaba a la
otra. Ademas el deposito contaba hoy como no tomada mientras no la anotara, asi que antes
de anotarla la ultima barra bajaba unos tres puntos y la tarjeta podia decir "1 dia sin
tomarla".
Decision: Se quedan las dos: el deposito en Graficas y "resaturando" en Hoy, junto al
criterio, mientras el deposito sube y Graficas todavia no lo da por lleno. La serie llega
hasta ayer y hoy entra solo cuando la anota. Los dias pasados sin anotar siguen contando
como no tomada, como dice el 2026-10-01.
Rejected: Que la grafica reemplace la nota, y contar hoy como no tomada antes de que la
anote.

## 2026-10-02 — La linea del peso sale con dos pesadas, tenue hasta tener cuatro
Context: Spec 1.1 pide cuatro pesadas en siete dias antes de dibujar la tendencia. La
grafica la dibuja con dos desde 27d04e4, para que no tarde un mes en aparecer, y eso nunca
se anoto aqui. Una media de dos pesadas se mueve mucho mas que una de cuatro, y en la
grafica se veia igual de fiable.
Decision: La grafica dibuja la media con dos pesadas, tenue y punteada hasta que la
ventana tiene cuatro. Lo que actua sobre la media sigue pidiendo cuatro: el recalculo de
metas (spec 3.6) y el resumen semanal.
Rejected: Esperar a cuatro (la linea no aparece hasta el segundo mes) y pintar la de dos
igual que una media de verdad.

## 2026-10-02 — Cada olla es su propio alimento
Context: El 2026-09-30 cocinar creaba o actualizaba un alimento por receta (`recipe-<id>`).
Las porciones se guardan como gramos de ese alimento, asi que volver a cocinar la receta
con otras cantidades reescribia los dias en que comio la olla anterior y las porciones que
le quedaban en la nevera, contra el 2026-09-25 ("un dia que ya paso no se toca").
Decision: Un alimento oculto por olla, no por receta. Sigue invisible en el catalogo y en
el buscador, se anota de un toque, y sus cifras salen de los ingredientes de esa olla.
Cocinar otra vez crea otro, y cada olla conserva sus numeros. Reemplaza el "crea o
actualiza" del 2026-09-30; el resto de esa entrada sigue igual.
Rejected: Un alimento por receta que se reescribe en cada coccion.

## 2026-10-02 — Una tanda drenada cuenta la mitad del rango
Context: Spec 7.3 pinta las calorias de una tanda drenada como un rango, de toda la grasa
ida a nada ida, pero el dia sumaba la etiqueta entera, de calorias y de grasa.
Decision: El dia cuenta lo que se comio, ajustado por lo drenado. Cuanto se drena no se
mide, asi que se toma la mitad de la grasa de la etiqueta: el dia suma la mitad de esa
grasa y las calorias del medio del rango, y con eso puntua. La proteina no cambia.
Rejected: La etiqueta entera, que cuenta grasa que se fue con el drenado, y pintar las
calorias del dia como rango, porque la nota necesita un numero.

## 2026-10-02 — Repetir desaparece cuando esa comida ya esta en el dia
Context: "Repetir" ofrece la ultima comida de ese espacio antes de hoy, y a proposito no
mira hoy, asi que el boton seguia ahi despues de usarlo: un segundo toque anotaba otra vez
la comida entera.
Decision: Cuando esa comida ya esta en el espacio de hoy, por el boton o a mano, el boton
se va hasta el dia siguiente. Hoy sigue sin repetirse a si mismo.
Rejected: Dejarlo para los dias en que se desayuna dos veces.

## 2026-10-02 — Lo que queda de una olla se puede tirar
Context: Una tanda solo salia del panel comiendose todas sus porciones, y el aviso de que
se esta pasando no tenia fin. Una olla que se echa a perder pasa cualquier semana.
Decision: "Tirar lo que queda" en la tarjeta de la tanda: las porciones que quedan pasan a
cero, no se anota nada como comido y el aviso se calla. Pregunta antes, como todo lo que
borra.
Rejected: Seguir sin forma de cerrarla, que obliga a anotar como comidas porciones que
fueron a la basura.

## 2026-10-02 — Quitar algo de la despensa no lo saca de las recetas
Context: Borrar un articulo de la despensa lo borraba tambien de todas las recetas que lo
usaban, y la receta pasaba a decir "se puede" y a cocinar una olla sin el.
Decision: La receta conserva el ingrediente y lo marca como faltante, por su nombre, hasta
que lo vuelva a tener. Solo editar la receta le quita un ingrediente.
Rejected: Que desaparezca de la receta, que es lo que pasaba.

## 2026-10-02 — El aviso de la olla sin lote lleva a la ficha del alimento
Context: El 2026-09-30 decidio que si un ingrediente medido no tiene ficha con peso, la
despensa se descuenta igual, no hay lote y la pantalla dice cual lo impidio. Pero ninguna
pantalla deja ponerle a un alimento lo que pesa una unidad, asi que el aviso pedia algo
imposible.
Decision: Lo del 2026-09-30 se queda, y el aviso abre la ficha de ese alimento, que pasa a
aceptar lo que pesa una unidad.
Rejected: Un aviso que nombra el arreglo y no lleva a ningun sitio.

## 2026-10-02 — El peso corporal va siempre en kilos
Context: El 2026-09-28 dice que el asistente convierte el peso segun la unidad de Ajustes.
El 2026-09-30 el codigo paso a guardarlo siempre en kilos (0f1e01d, con el comentario
"decision suya"), y eso nunca se anoto aqui, asi que este archivo y spec 20.2 decian lo
contrario del codigo.
Decision: El peso corporal va siempre en kilos, se escriba donde se escriba. La unidad de
Ajustes es para los pesos del gimnasio: las series si se convierten con ella. Reemplaza la
entrada del 2026-09-28.
Rejected: Convertir el peso corporal con la unidad de Ajustes.

## 2026-10-03 — Los commits salen con el correo privado de GitHub
Context: El repo es publico y cada commit lleva a la vista el correo de quien lo hizo. La
auditoria del 1 de octubre encontro el correo personal en todos los commits hechos desde la
computadora, y la fecha de nacimiento de la spec en diez archivos publicados.
Decision: Este repo firma con la direccion noreply de GitHub (`user.email` del repo), y
`.githooks/pre-commit` rechaza un commit con cualquier otra. Los tests y los scripts usan un
perfil inventado, y `src/public-repo.test.ts` falla si la fecha de nacimiento de la spec
aparece en algun archivo publicado, escrita de cualquier forma.
Rejected: Confiar solo en la config, que una copia nueva del repo no trae, y reescribir ya
el historial para borrar lo subido, que no tiene vuelta atras y queda para que el lo decida.

## 2026-10-03 — Un respaldo viejo se pone al dia antes de entrar
Context: La auditoria del 1 de octubre encontro que restaurar un respaldo de una version
anterior lo rechazaba entero (si era de antes de la migracion 042) o lo dejaba a medias: las
migraciones posteriores contaban como hechas pero nunca tocaban sus filas, asi que las
sesiones volvian sin hora de fiar, la leche sin su peso y Lecturas sin el estudio de la
creatina.
Decision: El respaldo se carga en una base aparte, en memoria, con el esquema de su version;
se le pasan las migraciones que le faltan, como le habrian pasado en el telefono, y eso es lo
que reemplaza lo que hay. Uno de la misma version entra tal cual, como antes. Las notas que
esas migraciones borran se rehacen solas en la siguiente carga, dentro de las doce semanas de
la cuadricula.
Rejected: Escribirlo tal cual sobre el esquema nuevo, que es lo que pasaba, y aceptar solo
respaldos de la misma version, que deja sin restaurar justo el dia que mas hace falta.

## 2026-10-03 — Ignorado es un aviso que salio y no tuvo respuesta
Context: Spec 18.2 regla 4 calla una semana el tipo de aviso ignorado tres veces seguidas, y
se contaba como ignorado todo lo planeado: lo que nunca llego a salir porque ya estaba
anotado, y los dias por delante. Quien anota a tiempo se quedaba sin avisos justo el dia que
se le olvidaba algo.
Decision: Cada aviso programado guarda la hora a la que sale (migracion 052). Si se cancela
antes de esa hora no lo vio y se borra. Si salio y despues anota lo que pedia, cuenta como que
hizo caso aunque no haya tocado el aviso. Solo lo que salio y se quedo sin respuesta cuenta
para callar. Las filas de antes, que no tienen hora, no cuentan.
Rejected: Seguir contando lo planeado, y contar como hacer caso solo tocar un boton del aviso,
cuando la reaccion para la que existe es abrir la app y anotar.

## 2026-10-03 — Los botones del aviso que anotan abren la app
Context: "+710 ml" y "Descanso" anotaban sin abrir la app, pero con la app cerrada iOS solo
la levanta por detras y expo da el toque por entregado antes de que corra nada de la app: el
aviso desaparecia y no quedaba nada anotado. Spec 18.3 promete que tocar el aviso y anotar en
la app terminan en el mismo sitio.
Decision: Esos dos botones abren la app, que es lo unico que garantiza que el toque se
aplica. Al abrir, la app lee el toque que la abrio y lo aplica una sola vez, aunque llegue
dos veces. "Hoy entreno" sigue sin abrirla: no anota nada, solo dice que hizo caso.
Rejected: Seguir sin abrir la app y aplicar el toque la proxima vez que la abra, que se
pierde si iOS cierra la app antes.

## 2026-10-03 — Dos recordatorios de creatina, a las 11:30 y a las 22:00
Context: Queria que la app le recordara la creatina. La idea era sacar la hora de lo que
anota, como las comidas, pero la hora a la que la toma no se guarda en ningun lado, y dijo
que en ese caso no se agregara.
Decision: Dos avisos fijos, a las 11:30 y a las 22:00, solo si ese dia no hay nada anotado
de creatina. No compiten por el cupo de tres al dia, el de las 22:00 cae dentro de la hora
de silencio a proposito, y no se callan por ignorados: los apaga anotarla o su interruptor
en Ajustes. Contradice spec 18.2 reglas 2, 3 y 4 solo para estos dos, y el tipo no esta en
la tabla de spec 18.1.
Rejected: Aprender la hora de cuando la anota, que necesitaria guardar esa hora, y meterlos
en el cupo, donde un dia cargado los dejaba fuera.

## 2026-10-03 — La proteina por dolar sale solo si la oferta nombra el alimento
Context: Cada resultado de una busqueda en Flipp quedaba atado al alimento de esa busqueda:
leche con chocolate, de coco y condensada con las cifras de la leche 1%, un champu de avena
para perros con las de la avena. En la recoleccion del 1 de octubre, 61 de las 121 cifras de
proteina por dolar eran de otra cosa, pintadas de verde y arriba de la lista.
Decision: Proteina por dolar y "bajo lo tuyo" solo salen cuando el titulo de la oferta nombra
lo que se busco y no trae ninguna de las palabras excluidas en Ajustes. La oferta sigue en la
lista, sin esas dos cifras. Sobre esa recoleccion, las ofertas con alimento pasan de 151 a 90.
Rejected: Dejarlo como estaba, y esperar al toque de confirmar de spec 16.5 para arreglarlo.
Ese toque sigue siendo la respuesta completa: lo que nombra el alimento sin serlo (pechuga
empanizada, avena para animales) todavia pasa.

## 2026-10-03 — Las flechas del peso suben 5 lb desde donde estan
Context: Spec 5.1 y 6.4 dicen que las flechas suben por el paso de cada maquina. El
2026-09-24 el codigo paso a 5 lb fijas (2.5 kg), porque la P156 sube de 15 en 15 y casi todas
las torres traen un bloquecito de 5 lb aparte, y eso nunca se anoto aqui. Ademas el resultado
se redondeaba a una cuadricula de 5 lb que empieza en cero, y desde un peso fuera de ella
saltaba a uno que no existe: de 17.5 a 25, de 42.5 a 50 en la polea Matrix.
Decision: Se quedan las 5 lb fijas, como el decidio, y se suman o restan desde el numero
puesto, sin redondear. El campo "paso" de cada ejercicio sigue sin mover las flechas.
Rejected: Volver al paso de cada maquina (10 lb en la mayoria de las torres de Fanshawe, que
con el bloquecito no es el salto util) y seguir redondeando a la cuadricula desde cero.

## 2026-10-03 — El agua se anota en tres medidas y se deshace toque por toque
Context: La auditoria del 1 de octubre encontro que el agua no tenia "menos uno": la unica
correccion era "Reiniciar", que borraba el agua entera del dia sin preguntar y estaba a ocho
puntos de la botella.
Decision: Cuatro botones: "+ 150 ml", "+ 300 ml", "+ 710 ml" y "Deshacer". Deshacer quita el
ultimo toque a cualquiera de los tres; dos veces, los dos ultimos, y asi hasta el primero del
dia. Los toques de hoy se guardan, asi que siguen ahi si iOS cierra la app; al dia siguiente ya
no hay nada que deshacer. "Reiniciar" desaparece. Lo que entra por el asistente o por el boton
del aviso no es un toque y no se deshace con esto.
Rejected: Un "menos una botella" y dejar "Reiniciar" detras de una pregunta, que era lo que
proponia la auditoria.

## 2026-10-03 — Terminar en el gym marca el tiempo de la sesion como de fiar
Context: El 2026-09-30 decidio que solo las sesiones marcadas entran en "sueles tardar", en la
hora de salida y en la grafica de tiempo, pero nada marcaba una sesion nueva: desde el 1 de
octubre ninguna entraba salvo que fuera a Registros a marcarla a mano.
Decision: Al tocar Terminar, la sesion queda marcada si duro de 20 minutos a 2 h 30 y termino a
menos de 20 minutos de la ultima serie, que es lo que distingue cerrar en el gym de cerrar en
casa. El interruptor del dia sigue para lo que esto no acierte, y reabrir y volver a terminar lo
decide otra vez. Lo guardado antes se queda como lo marco la migracion 050.
Rejected: De 20 minutos a 4 horas, el rango de la migracion 050, y dejar todas las nuevas sin
marcar hasta que las marque a mano.

## 2026-10-03 — Quitar de la despensa lo que usa una receta lo deja vacio
Context: El 2026-10-02 decidio que quitar algo de la despensa no lo saca de las recetas, que
lo marcan como faltante por su nombre hasta que lo vuelva a tener. La tabla de ingredientes
borra en cascada lo que se borra de la despensa, asi que eso necesitaba decidir que pasa con
la fila.
Decision: Si alguna receta lo usa, "Quitar" no lo borra: lo deja en cero, en "no hay" o sin
tener, segun como se tenga, y la pantalla dice en que recetas sigue. Volver a tenerlo es
cambiar esa misma fila. Lo que ninguna receta usa se borra como antes.
Rejected: Rehacer la tabla de ingredientes con una migracion para que guarde el nombre, que
deja recetas apuntando a algo que ya no existe y obliga a reconocerlo por nombre al volver a
comprarlo.

## 2026-10-04 — Reliable record queries and researched recipes
Context: The assistant review reproduced incorrect record semantics, ignored nutrition
dates, ambiguous exercise selection, unsupported pantry requests and conversation-state
errors. The owner approved the complete proposed plan and recommendations, but requested
credential preparation first and will delegate implementation in a subsequent message.
Decision: Keep a hybrid assistant. Common questions query local records without requiring
a model; models interpret broader requests and explain verified results. Protein uses the
requested date and its target. Missing records remain unknown rather than implying zero
consumption. A weight record means the greatest recorded working-set load over all history
unless a range is requested, preserving per-dumbbell versus total-load conventions and the
latest date that maximum occurred. Estimated 1RM is returned only when explicitly asked.
Exercise resolution supports partial names and aliases, keeps variants separate and reports
all relevant ambiguous matches. Single-day histories and sets above twelve reps remain
valid weight records. Dates, follow-up questions and punctuation variations are covered.

New recipe requests work without saved recipes: search real sources, link them, compare
ingredients and amounts with actual pantry stock, and report portions, steps and missing
shopping items. Generating a suggestion does not save it, log food or consume inventory.
Interpreted writes require confirmation, cannot invent quantities and preserve the date,
exercise, session and units displayed at confirmation. Fix stale replies after chat changes,
concurrent submissions and pending actions left active after errors. Personal-data claims
must be backed by actual queries rather than unconstrained model text.

Use Groq's free inference tier and Tavily's free search tier as the cloud candidates, with
Apple Foundation Models retained as a local option. Compare candidates on the same Spanish
questions before choosing the cloud model; simulated intents do not prove native model
accuracy. Cloud use is visible, sends only the request and relevant context, and stops at
free-tier limits without enabling paid billing. Credentials are supplied locally through
GROQ_API_KEY and TAVILY_API_KEY in the ignored .env.assistant.local preparation file; they
must never enter Git, public build artifacts or logs. The current app does not load that
file. Runtime provisioning remains part of the subsequent implementation.

Acceptance covers record units and dates, aliases and ambiguity, nutrition dates and absent
data, follow-up context, read/write separation, stable confirmations, empty recipe libraries,
pantry quantities and states, real recipe sources, unavailable models, invalid responses,
database failures, network failures and exhausted quotas. Repeat model-understanding tests
on the actual phone; local harness results and native-model results are reported separately.
This decision supersedes the restrictive assistant scope of the 2026-09-29 entry and SPEC
sections 20.2, 20.3, 20.6 and 21.7 where they conflict. SPEC.md itself remains unchanged.
Rejected: Swapping only the model while retaining incorrect queries; treating estimated
strength as recorded weight; silently selecting one exercise; limiting recipe suggestions
to saved recipes; downloading a larger local model before measuring it; paid cloud usage;
starting the implementation during credential preparation.

## 2026-10-07 — Learn exercise cycles from durable set taps and estimate remaining work
Context: The owner requested an exit time that follows remaining exercises and series, approximate minutes per exercise and per series, and a way to inspect or correct late taps. The prior September 30 decision covered total session duration only; this request extends that scope.
Decision: Keep the existing completion timestamps as the original evidence, captured at the tap. Store timing eligibility, review state and optional corrected interval seconds separately. Persist derived exercise/implement summaries when closing a session, with invalidation on edits and rebuilding from the original events. Backfill comparable closed sessions from the preceding 90 days. Learn within the same gym, implement and time budget; keep at most 20 observations per exercise for pace. A cycle includes the series and its intervening rest, not individual repetitions. Estimate missing cycles, including the first, from accepted intervals without counting those estimates as observations. Use the median historical cycle for ETA and blend in today's accepted intervals; display arithmetic daily averages separately. Sum only remaining planned series, plus unfinished startup and transition allowances. An overdue cycle cannot silently mark work complete.
Potential outliers remain visible and editable. Automatic review uses broad 20-second/15-minute bounds and, after five comparable session observations, a modified median/MAD rule with a conservative tolerance floor. These are product heuristics, not physiological limits. Users can confirm a real interval, exclude an unreliable tap and its neighboring interval, correct interval minutes, or restore automatic handling. Corrections retain the original timestamps and invalidate affected later learned summaries. Retroactive series and transitions do not teach the clock. Total-session duration trust remains independent, so a forgotten finish does not discard valid intervals between earlier taps.
Rejected: Temporary-only events, because closing the app would lose evidence; measuring seconds per repetition from completion taps, because those taps do not distinguish execution from rest; treating inferred first cycles as actual measurements; using the full-session median as a fixed exit time; deleting unusual observations automatically.

## 2026-10-07 — Make training session actions atomic and retryable
Context: The training review identified partial session/plan writes, duplicate starts and write failures visible only in the console. The owner approved findings 1–3.
Decision: Create a session and its approved plan in one serialized transaction, and replace routine metadata and its plan in another complete transaction. Repeated starts share pending work and reuse a recent active session even before the screen reloads. Start, finish, reopen and routine changes report their persistence outcome to the screen, show pending progress and keep an action-specific error with a retry. Retrying a start uses the currently displayed plan; routine changes preserve the previous display until their write succeeds. Existing successful routine-replacement behavior remains outside this reliability pass.
Rejected: Partial plans after storage failures, optimistic routine labels that suggest an unsaved change succeeded, swallowed write errors and duplicate sessions from quick taps.

## 2026-10-07 — Publish the training release within today's requested contribution range
Context: The owner requested organized commits, a push and an IPA build, with 3–10 contributions dated today. GitHub reports zero contributions for October 7 before this release.
Decision: Publish three substantive commits directly to main with their actual current dates: exercise timing persistence/calculations, atomic session-plan writes, and screen/provider integration with live estimates and retries. This release-specific range overrides the default single-commit squash convention. Dispatch the existing iOS workflow after publication and verify it targets the published revision.
Rejected: A single squashed commit that misses the requested minimum, empty commits to pad the count, altered commit dates, and an unrequested pull request.

## 2026-10-07 — Review routine changes and edit remaining session work
Context: The owner approved training findings 4–8. Changing routines replaced customized targets immediately, and the live estimate could retain exercises no longer intended for that workout.
Decision: Review a proposed routine change before applying it. Preserve order, counts and rest for shared exercises; retain completed work from departed exercises and show how much pending work the proposal removes. The same session-only editor can add, omit, replace and reorder exercises or adjust remaining series. Replacing a partially completed exercise transfers only its pending series; logged sets stay attached to their original exercise. Saving cannot lower targets below completed working sets, mutate base routines or silently apply a stale preview. Plan and routine writes remain atomic, cancellation writes nothing, and failures retain edits for retry. The remaining-time estimate follows the newly approved plan.
Rejected: Immediate routine replacement, deleting or relabeling completed series, changing the reusable routine while editing one workout, and automatically treating an unplanned exercise as a replacement.

## 2026-10-07 — Combine multiple workouts by their own planned size
Context: The daily score compared every working set on a date against the latest session's plan. The owner explicitly selected combining workouts according to their size rather than using only the best workout.
Decision: Evaluate each nonempty session against its own plan using the existing training fraction and cap each session's completion before combining them. Weight those fractions by planned muscle-weighted sets, with the existing 24-unit reference for a session without a plan. Empty sessions and warmups do not participate. The daily training criterion still contributes at most 22 points. Invalidate stored scores only for dates with multiple sessions, and rebuild them through the existing scoring path. Warmup taps also bypass optimistic working-set progress, so they cannot prematurely select the next exercise. Remove the interactive wrapper around Today's records grid while retaining its Records button and individual day actions.
Rejected: The last session's denominator for the whole day, double daily training points, counting abandoned empty sessions, allowing excess work in one session to hide another session's incomplete plan, and resetting unrelated historical scores.

## 2026-10-08 — Concrete exercise variants and a durable personal catalog
Context: The owner approved resolving duplicate exercise/equipment choices and completing catalog saving and personalization before further timing work. Selecting generic lateral raises with dumbbells did not replace pending cable sets, and explanation fields saved only on blur.
Decision: Reuse the existing exercise-variant relation to group training choices by family. Variant controls explicitly transfer only the current exercise's pending series, retain completed work and update the plan and remaining-time estimate atomically. Different exercises remain separate unless the user replaces them through the plan editor. Convert legacy equipment choices to concrete variants without rewriting historical sets or overwriting existing explanations. Newly created alternatives do not silently change automatic routine preferences. Support creating exercises and variants, muscle assignments, routine membership, editable family names and reversible archiving. Pending work must be replaced or omitted before its exercise is archived. Persist catalog content in SQLite and include it in existing backups. Save explanations and names while typing through ordered writes with visible saving, saved and retry states; note edits update only the affected loaded notes. Track custom origin and edits for future catalog maintenance. Live Activities remain outside this change.
Rejected: Equipment chips that only change a label, counting a replacement as additional pending work, deleting historical sets when archiving, overwriting personal explanations with catalog defaults, and reporting a failed or unfinished write as saved.

## 2026-10-08 — Review the next UX changes before implementation
Context: The owner requested grid, refresh, training-preference, location and health-import changes, then explicitly limited this round to investigation and documentation.
Decision: Record confirmed requirements, code findings, alternatives and pending validation without changing application code, dependencies, migrations, build configuration or SPEC.md. Preserve previous uncommitted training/catalog work. Detailed local planning is in `audit/UX-REFRESH-HEALTH-2026-10-08.md`; recommendations in that report are not represented as already implemented or separately approved choices.
Rejected: Starting implementation, committing, publishing or building an IPA during this review.

## 2026-10-08 — Use solid contribution squares with bounded history
Context: The owner wants solid GitHub-like squares instead of proportional fill, twelve visible weeks and access to older periods without interfering with tab navigation. The owner explicitly selected the proposed nonzero color buckets in a clarification reply.
Decision: Use #D1D5DB for an actual zero, #A7D9B0 for scores greater than zero through 25, #70BB84 for greater than 25 through 50, #36985B for greater than 50 and less than 100, and #17683A only for exactly 100. Apply these boundaries to decimal scores without rounding. Missing data remains distinct from a recorded zero. Show a bottom-right Menos-to-Más legend with the four greens, Spanish abbreviated months above, and twelve week columns at a time. History begins January 1, 2025 and ends at the current week, advancing with time. Only gestures starting inside the day-square area browse history; outer margins and labels do not. Both ends bounce back without handing the gesture to the tab pager. Preserve day details and numerical accessibility. This request supersedes SPEC section 4.5's fill treatment for this grid; SPEC.md remains unchanged. Reconciling the existing palette picker, windowed loading and precise native gesture mechanics remains implementation work.
Rejected: Partial-fill squares, continuous gradients for this grid, rounding an incomplete score to the darkest green, representing absent data as failure, unrestricted future scrolling, and a whole-card horizontal gesture region.

## 2026-10-08 — Add refresh while preserving daily state and planned training
Context: The owner wants pull-to-refresh, Solo selected by default and a manually chosen routine retained when reopening the app. Code review confirms pre-session routine/gym choices are local state; foreground day changes already reload, but continuously active midnight and date-independent grid memoization remain gaps.
Decision: Plan a native top pull-to-refresh and reliable daily invalidation while preserving entered data and an active workout. Keep the automatic routine recommendation, but a valid manual selection for the planned day takes precedence after reopening. Solo is the default. A planned gym must remain selected when location finds neither known gym. A separate durable pre-session draft and completion-aware reload are recommended mechanisms; budget/order persistence, draft expiration and last-gym defaults are detailed proposals in the local review, not new confirmed preferences.
Rejected: Resetting the app to refresh it, relying on manual refresh as the only day-change fix, replacing the owed-routine algorithm, and letting reloads discard unsaved input or a planned workout.

## 2026-10-08 — Detect the gym on Training entry with a foreground reading
Context: The owner wants fewer taps, frequently passes through the middle Training tab, and explicitly rejects continuous location tracking. The earlier September 16 decision restricted the trigger to the location button.
Decision: Plan automatic one-shot foreground detection when entering Training and retain an explicit icon-only location button aligned with the gym choices. A recognized gym can update the selection; no match must preserve it. No continuous watcher, background location or geofence. This request supersedes only the manual-trigger restriction in the September 16 entry and SPEC section 5.2. The recommended northeast navigation icon, brief focus dwell, roughly two-minute automatic cooldown, accuracy handling, shared in-flight requests and protection from late responses are documented for implementation review. No timing or battery-performance guarantee has been measured.
Rejected: Selecting Otro automatically when outside a gym, repeatedly starting high-accuracy fixes during rapid tab traversal, overwriting a newer manual choice with an old response, and asking for always-on location permission.

## 2026-10-08 — Reassess Health imports against current signing evidence
Context: The owner requested sleep/steps import analysis under the existing Expo, SideStore and free-account setup. The September 16 entry attributed the earlier deferral to Apple's capability matrix excluding free accounts. Current [Apple documentation](https://developer.apple.com/help/account/reference/supported-capabilities-ios/) marks HealthKit available in the free Apple Developer column; its HTML checkmarks were inspected directly. Conversely, the current [SideSign entitlement model](https://github.com/SideStore/SideSign/blob/main/Sources/Models/Entitlement.swift) omits HealthKit from its free allowlist. The installed SideStore version and resulting signed app have not been inspected.
Decision: Correct the factual basis of the earlier deferral without promising that the current signing path works. Keep the no-paid-membership constraint and defer implementation during this analysis-only round. Recommend a small future HealthKit signing/read probe before choosing a native bridge. Expo custom builds can include native code; adding a JavaScript button to Expo Go cannot supply a missing native reader. Consider a Shortcut bridge if direct signing fails; [AutoSleep documents a Time Asleep dictionary](https://autosleepapp.tantsissa.com/today/shortcuts) with a sleep-hours value and session bounds. Current source chips only label manual values and must not be described as importers. Preserve manual entry and design imports around explicit dates/sources, replacement rather than additive totals, duplicate-source handling and unknown-versus-zero semantics. The full data and validation proposals are in the local review.
Rejected: Declaring paid Apple membership inherently necessary from the old note, guaranteeing free SideStore compatibility from Apple's matrix alone, implementing an unverified native dependency, and treating empty Health reads as zero or summing overlapping sleep/step sources.

## 2026-10-08 — Implement the score-square appearance as the first separate step
Context: After the review, the owner authorized working through the items one at a time, starting with the squares, and requested a change summary and the remaining items after completion.
Decision: Implement the five agreed solid color buckets, distinguish missing/unscorable days from a recorded zero, retain today's outline and day details, and add Spanish month headings and the bottom-right four-green legend. Replace the previous palette chooser with an explanation of the fixed scale; retain legacy setting compatibility for backups without allowing old palette choices to override the grid. Keep out-of-range padding inert and include the loaded date and data-presence state in grid memoization. This step does not alter scores, add migrations or implement historical scrolling. Horizontal history and gesture ownership remain the next item; day rollover, refresh, training drafts, location and Health imports remain pending.
Rejected: Implementing all reviewed features together, leaving a palette selector that no longer affects the display, and changing stored scores to fit presentation buckets.

## 2026-10-09 — Make the contribution scale a saved display preference
Context: The owner expanded the first grid step to include five tonal palettes and editable boundaries in Settings, then authorized history, day rollover and refresh as steps 2–4.
Decision: Offer green, pink, red, blue and black palettes, each with four increasing intensities. Retain the same gray recorded zero and outlined missing/unscorable state across palettes. Persist the palette and three strictly increasing numeric boundaries in the existing settings table, including backups. Default to 25/50/100; preview edits before explicit saving and expose storage failures with retry. When the darkest tone starts below 100, label it Muy alto rather than Completo. Colors never rewrite scores or alter streak thresholds. This supersedes the fixed-scale picker decision from October 8; SPEC.md remains unchanged.
Rejected: Separate thresholds per palette, a new schema for a single preference, rounding decimal scores before assigning colors, and announcing an unsuccessful save as saved.

## 2026-10-09 — Browse bounded history with native scrolling and period reads
Context: The owner authorized January 2025 history with twelve visible weeks, isolated gestures and elastic end behavior.
Decision: Use a horizontal native FlatList restricted to the day-square rectangle, with Spanish month headings above and the legend below outside its gesture region. Bound dates to January 1, 2025 and the current week, keep padding days inert, and follow new weeks only when already viewing the latest period. Request historical data in buffered periods through two range-filtered reads without rescoring history. Display loading/failure states and the visible period's average. Acquire a scoped tab-swipe lock on contact, release it on gesture completion, cancellation, background or loss of focus, and retain other gesture owners. Enable native directional locking and elastic overscroll without adding libraries. Browser checks cover bounds, persistence, widths and touch ownership; actual iOS bounce and nested recognizer behavior remain a device acceptance check.
Rejected: A draggable whole card, future browsing, reading all daily details on every drag, and switching tabs when dragging past an edge of the grid.

## 2026-10-09 — Refresh local state and advance the loaded day automatically
Context: The owner authorized pull-to-refresh and reliable day changes before the remaining training/location/Health work.
Decision: Add native pull-to-refresh on Hoy, Entreno, Comida and Ofertas. Coalesce repeated refreshes, await the load that actually replaces the displayed state, retain the last successful view on failure, and preserve mounted forms and training state during same-day refresh. Reread local slices without historical rescoring unless the calendar day changes; the existing offers download button remains separate. Check local midnight while active, stop the date timer in the background and recheck immediately on resume. A lightweight minute check also catches clock/timezone changes without rendering a ticking screen. Loads spanning midnight must finish on the current date. Existing date-scoped daily fields and overnight workout ownership remain intact. No GPS or Health reads are added.
Rejected: App restarts as refresh, a decorative spinner ending before completion, stale reads overwriting newer writes, always-on background work, and making manual refresh necessary every morning.

## 2026-10-09 — Exclude grid drags from the sidebar gesture
Context: The owner requested removing the visible month/year period line and preventing a rightward drag over the squares from opening the left menu, matching the tab-swipe exclusion.
Decision: Remove the visible period summary while retaining month headings and the period in the grid's accessibility hint. Make the sidebar's opening capture consult the same scoped swipe lock as the grid and tab pager, using an immediate read so a fast move cannot beat React's touch-start update. Preserve the existing outside-grid edge gesture and the explicit menu button. Regression checks cover immediate acquisition/release, the overlap between the first column and the sidebar edge region, direction/route restrictions and explicit open/close.
Rejected: Disabling the sidebar everywhere, expanding the grid's active touch area to its margins, and maintaining separate menu and tab locks that can diverge.

## 2026-10-09 — Publish eight commits across October 8 and 9
Context: The owner requested organizing every unpublished change into 5–15 commits with dates between October 8 and October 9, then publishing and launching an IPA.
Decision: Group the completed work into eight substantive commits: weighted daily workouts, persistent exercise catalogs, autosaved editing, session-plan review and variants, customizable historical squares, day rollover and refresh, sidebar gesture isolation, and decision records. Use four author/committer dates on October 8 and four on October 9, within the owner's explicit range and the existing daily contribution ceiling. This release-specific instruction overrides the default single-commit squash and current-date convention. Preserve the remote bot offer updates, publish normally without a pull request or rewriting published history, then dispatch the existing unsigned iOS workflow for the exact final revision and verify its result.
Rejected: Empty commits to pad the count, an unrequested pull request, changing published history, and building a revision that does not contain the complete approved work.

## 2026-10-09 — Remember the day's planner choices and default to Solo
Context: The owner asked for Solo selected by default and for a manually chosen routine and gym to survive closing the app, then accepted the recommended details from the October 8 review.
Decision: Store one date-scoped planner draft in the settings table (`planner_draft`), separate from the in-session `session_draft`. It keeps the manual routine, gym, company, time budget and the edited order and set counts for the plan they belong to. Company starts as Solo and the two company chips are exclusive. On the same day the planner restores the draft before any automatic recommendation; without a manual routine the owed routine still applies. On a new day only the gym carries over; the planner remounts on the date change. Saved edits apply only when the freshly loaded plan has exactly the same exercises, otherwise the plan loads as computed with a visible notice. A routine or gym that no longer exists is dropped with a notice. Writes happen only when a choice changes, without reloading anything, and a failed write is shown until a later write succeeds. Starting a session does not clear the draft: the planner cannot reappear the same day once a session exists, and the date retires it.
Rejected: Keeping the routine override across days, letting company return to unselected, reviving a removed exercise from a stale draft, a schema migration for a single preference, and reloading app state on every planner tap.

## 2026-10-09 — Read the gym on entering Entreno, with a compact arrow
Context: The owner approved implementing the October 8 location plan: an icon-only control beside the gym choices and a one-shot foreground reading on entering Training.
Decision: Replace "Usar mi ubicación" with the Lucide navigation arrow in a fixed spot to the right of the gym chips (34 pt drawn, 44 pt touch area, same accessible name). Chips show the first word of a gym's name unless two would read the same; VoiceOver reads the full name. The three gyms and the arrow fit one row from 375 px; at 320 px the chips wrap and the arrow stays put. With Entreno in front and the app not in the background, the planner waits 400 ms and asks for one automatic reading; returning to the app on that tab counts as entering. The automatic reading checks permission without prompting, uses the phone's cached position when it is under 60 s old and decisive, and otherwise takes one balanced-accuracy fix at most every two minutes. The arrow prompts for permission when needed, skips that wait, asks for high accuracy and joins any reading already in flight. A reading decides only with a known error of 100 m or less: inside a radius is that gym, outside every radius even allowing for the error is elsewhere, anything else is inconclusive. A match replaces the selected gym; elsewhere, inconclusive, denial and errors never change it, and the automatic path shows no message. Tapping a gym, leaving the tab or a 20-second display deadline retires a reading in flight, so a late answer changes nothing, while the native request stays counted until it ends. Timing and accuracy values stay provisional until measured on the actual route.
Rejected: Continuous or background location, prompting for permission on tab entry, a fresh high-accuracy fix on every pass through the tab, classifying fixes without their reported error, and selecting Otro automatically.

## 2026-10-09 — Quiet automatic gym reading, X for Wednesday and a shorter grid header
Context: The arrow showed a loading animation every time Entreno opened; the grid sometimes stayed on "Cargando historial…" after browsing back; the owner asked for less space above the squares and X for Wednesday.
Decision: The automatic reading shows nothing on the arrow and only changes the screen when it finds a gym. The arrow has no spinner: after a tap it stays sunk into its shadow until the reading answers or the 20-second deadline passes. History is read whenever the visible twelve weeks are not covered by the recent data or a current read, not only when the browsed page changes; the stuck state came from a read made on another page that left part of the current window unread. The grid header overlaps the card padding by 8 points above and below, about three quarters of its previous height, keeping the 40-point Registros touch area. Weekday labels read L M X J V S D.
Rejected: A visible indicator for a reading he did not ask for, and shrinking the Registros touch target.

## 2026-10-09 — Import sleep and steps through an iOS Shortcut link
Context: The owner wants sleep and steps to arrive without typing them. The app is re-signed by SideStore with a free Apple ID: SideSign allows HealthKit only for paid teams, another app installed the same way documents HealthKit doing nothing on free-signed builds, and the IPA is built unsigned, so no entitlement would even travel inside it. The owner approved skipping the native probe proposed on October 8 and using a Shortcut instead.
Decision: Register the `nexo` URL scheme. An iOS Shortcut reads AutoSleep's Time Asleep and the day's steps from Health and opens `nexo://salud?fecha=&sueno=&inicio=&fin=&pasos=`. Sleep arrives in decimal hours and is stored in minutes; it belongs to the local day of `fin`, otherwise to `fecha`. Steps belong to `fecha`, today when absent. Empty or zero means no data and writes nothing. An unknown key, a malformed value, a date outside the last seven days or a future instant refuses the whole link with the reason. Each value is written with its receipt in `core_health_import` (migration 059), one row per date, metric and source, in the same transaction as the daily log; reimporting replaces and never adds, even when lower. A day value that differs from its last import counts as typed by hand and is not overwritten until he chooses on a card in Hoy, where the app goes when a link arrives. Past dates are rescored; today is reread without the history pass. Hoy shows each value's origin, the source and arrival time or "a mano"; the AutoSleep and Apple Health chips that only relabeled a typed value are removed, and typed sleep is saved as manual. This supersedes the September 16 deferral and the October 8 probe recommendation; SPEC.md is unchanged.
Rejected: A native HealthKit dependency and signing probe under the free account, adding imports together, recording zero for missing data, silently overwriting typed values, and background syncing.

## 2026-10-09 — Run the health Shortcut from a button on Hoy
Context: With the Shortcut route working, the owner asked whether Nexo itself could start the import instead of him opening Shortcuts.
Decision: Add "Traer de Salud" to the right of the Sueño title in Hoy's daily log. It opens `shortcuts://run-shortcut?name=Nexo%20Salud`; Shortcuts runs the owner's Shortcut, which returns to Nexo through the existing `nexo://salud` link and its card. The name is fixed in code and must match the Shortcut on the phone. If Shortcuts cannot be opened, the field says so. The button appears only on Hoy, because the Shortcut always reads today. iOS shows Shortcuts briefly; an app cannot run a Shortcut invisibly.
Rejected: Running the Shortcut automatically whenever Nexo opens, which would flash Shortcuts on every launch and could loop through its own return link, and offering the button on past days that the Shortcut cannot read.

## 2026-10-09 — Show the training week streak on Hoy
Context: Spec 4.4 asks for a training streak, consecutive weeks hitting five sessions, shown on Today and above the grid. It was never built.
Decision: Count Monday-to-Sunday weeks with at least five training days (days with a working set), walking back from the current week. The current week adds once it reaches five and never breaks the streak before it ends, like today in the day streak. Marked rest days are not sessions. The whole history is read in one query per load, and the line sits in the Hoy score card under the day's note, above the grid.
Rejected: Rolling seven-day windows, counting rest days as sessions, and another line in the grid header right after its height was reduced.

## 2026-10-09 — Confirm deal matches with one tap
Context: Spec 16.5. The October 3 entry still gave protein per dollar to products whose title names the food without being it, such as breaded chicken.
Decision: A deal whose title names the food it was found for asks "¿Es …?" with Sí and No; once answered it says "Es …" or "No es …" with Deshacer. No removes protein per dollar and the comparison with his usual price from that deal. Answers live in deals_match_verdict (migration 060), keyed by the deal title without case or accents and the food, so they survive every collection and apply to every deal with the same text. Unlike the rest of the deals tables they are his data and go into backups. The answer paints at once and the write follows; a failed write rereads the deals.
Rejected: Keeping answers in deals_match, which each collection rebuilds, asking about deals whose title does not name the food, and leaving answers out of backups.

## 2026-10-09 — Show what a recipe portion does to the day, and propose pots like the last one
Context: Spec 21.3 promises a recipe's portion figures and what one does to the day before cooking; spec 7.3 asks for approximate pot calories and a default portion count. The owner asked for both.
Decision: A recipe computes its pot from the same inputs cooking uses (the whole food catalogue and the current pantry) and shows protein and kcal per portion, plus "te deja en N g de proteína hoy, X bajo la meta" against the protein floor, which is the band's lower edge with no ceiling. Ingredients that are never measured, durables and spices, are named as not counted, and a recipe whose pot cannot be weighed says why. A pot portion reads "unas N kcal"; protein stays plain. Choosing a catalogue food for a new batch proposes the raw weight and portions of its last batch, only in empty fields, with a note saying where the numbers come from.
Rejected: A fixed portion count invented by the app, overwriting what he typed, and estimating the oil or spices nobody measured.

## 2026-10-09 — Change the pantry from the assistant
Context: Spec 21.5 makes the assistant the pantry's fast path ("se acabo la leche", "compre 18 huevos", "queda poca whey"), but the command table in spec 20.2 had no pantry commands. The owner chose to add them.
Decision: The grammar accepts compre, quedan/queda/hay with an amount, se acabo/no hay, queda poco or poca, and hay, with optional g, kg, ml or l. Pantry commands are read before any date and carry none; one written with a date is refused. An item is matched by name, singular or plural, then by its leading words; none or several matches are reported, never guessed. Counted and weighed items take amounts in their own unit; durables only take hay, poco or no hay; spices only hay or no hay. Typed commands write at once. Model-interpreted ones are confirmed with the item's current stock and must be grounded in the sentence: the item, the kind of change and any amount. A change that cannot apply is reported before asking to write it. Nothing reloads, because the pantry scores nothing.
Rejected: Creating pantry items from the assistant without their kind and unit, dating pantry changes, and accepting a model line whose item or amount the sentence does not contain.

## 2026-10-09 — Say how much evidence a training estimate rests on
Context: Training finding 9: a learned pace can come from a single interval, and the estimate read the same either way. The owner asked for it now rather than after weeks of data.
Decision: The remaining-time estimate reports, among pending exercises with a learned pace, the fewest measured workouts behind any of them, today included once it has an interval. Below five, the same threshold the interval review uses, it says the estimate still rests on little data; from five it states that minimum. Ranges and calibration against actual finish times wait for real data.
Rejected: Showing a time range before measuring forecast error, and treating the plan-only estimate as evidence.

## 2026-10-09 — Less on screen: deal answers behind a pencil, no chart captions, no Repetir
Context: The owner found Ofertas, Gráficas, Comida and the score settings crowded.
Decision: Ofertas gets a pencil beside its title; the "¿Es …?" question with Sí, No and Deshacer appears only while it is on. The captions that explained each chart are removed; empty-state messages stay, and the muscle chart keeps its seven-day window in its title. Comida loses "Repetir" along with the code that only served it: the last meal per slot, the repeat query and the provider action. The boundary fields in the score settings shrink to 32 points, enough for the number.
Rejected: Keeping the captions behind an info button, and hiding Repetir instead of removing it.

## 2026-10-09 — Project the creatine tank to full
Context: The owner wants the creatine card to say when the tank is estimated to be full instead of a generic phrase, and dropped the days-in-a-row count and trend.
Decision: From the last day of the series, the tank is projected taking creatine daily with the same filling rule until it reaches the full band at 90%, drawn as dashed estimated bars after the real ones. The card states the level and "se estima llena el <día>"; a full tank keeps "llena: …". The streak and trend are removed. The curve never touches 100% because filling slows as the tank fills, so full means the band the chart already showed.
Rejected: Projecting to a literal 100%, which the model only approaches, and keeping the streak line.

## 2026-10-10 — Fewer food suggestions in Comida
Context: The owner found the picker's suggestion lists too long.
Decision: "de siempre en <espacio>" shows at most two foods and "recientes" at most three; everything else stays one tap away in the full list.
Rejected: Removing either list, which is what makes logging the usual meal two taps.

## 2026-10-10 — Meal slots as icons, the chosen one named
Context: The five meal slot chips in Comida did not fit one line and "cena" wrapped. The owner picked the recommended option.
Decision: Each slot is an icon that follows the day (sunrise, coffee, sun, sunset, moon); only the selected chip also writes its name, and every chip keeps its full name for VoiceOver. The slot chips sit 4 points apart with less padding, so all five fit one line from 375 points wide, the narrowest iPhone that runs the app, even with "media mañana" selected.
Rejected: Icons alone, which make sunrise and sunset easy to confuse; abbreviations; a segmented bar with two-line labels; and a sideways-scrolling row, which fights the tab swipe.

## 2026-10-10 — Each chart picks its own range; gym time by routine
Context: The owner wants to read some charts by week and others by month or year, to see gym time per routine, and to learn from a creatine bar whether it was taken that day.
Decision: Every chart except the seven-day muscle sets carries S, M, T and A circles (week, month, quarter, year) at the right of its title; the screen reads a year once and each chart shows its own slice. Choices are saved per chart in the `chart_ranges` setting and default to the quarter. The single range row above all charts is removed. Gym time has a routine filter, "Todo" by default, listing the routines present. Touching a creatine bar shows the date, "Creatina tomada", "No la tomó" or "Sin anotar", and the details button, not the tank percentage. The "banda … a …" line under charts and the muscle chart's band footer are removed; the bands themselves stay drawn.
Rejected: Keeping one shared range, which forces every chart to the same period, and a range on the muscle sets, whose band is defined per week.

## 2026-10-10 — Bar charts keep a slot for every day, starting at the first data
Context: With the week range, days without data simply vanished, so four bars stretched across the card and it was not clear which days were missing.
Decision: A bar chart draws one slot per calendar day of its range, and a day with no value is an empty slot with nothing drawn and nothing to touch. Nothing is stored or turned into a zero; only the drawing changes. The range starts at the first data of that chart when that is more recent than the range's edge, so the year view of three months of data shows three months. Two gym sessions on one day share the slot: minutes add up and the bubble names both.
Rejected: Writing zeros for missing days, which would read as a measured zero; and always drawing the full range, which shows months of empty slots before the app was in use.

## 2026-10-10 — Charts slide through the whole history, day by day
Context: The owner wants to see any window of a chart's range, days 1 to 7 or 3 to 9, any thirty days, and not only the one that ends today.
Decision: Gráficas reads the whole history once, from 1 January 2025 like the grid, which costs the same statements as a month. Every chart with range circles starts at its own first data and slides through it with the phone's native scroll, only inside the rectangle of the bars or the weight line; outside it, swiping does the usual, which on iOS 26 is going back. Letting go snaps to whole days: with the finger still, a day more than half visible stays in; letting go while moving carries on to the next whole day in that direction, as native snapping does. A chart opens on the window ending today and opens there again when its range, routine, exercise or measure changes. The vertical scale comes from the whole history, so bars keep their height while sliding. Only the pages near the window are drawn. The creatine estimate waits to the right of today. The weight line puts each weigh-in on its own day, so a gap keeps its width. When the whole history fits the range, the bars fill the card and a swipe inside them still answers, with the end bounce and nowhere to go (changed the same day at the owner's request; the scroll content is one device pixel wider than the card because iOS 26 only lets a scroll view win over the back swipe when its content is wider than its frame).
Rejected: A drag handled in JavaScript or a gesture library, which is less smooth and, for the libraries, pulls in Reanimated, which crashed the app; one drawing as wide as the history, which in the weekly view of a year does not fit in memory; a scale per visible window, which resizes the bars under the finger.

## 2026-10-10 — Gym time and exercise progress can hide their empty days
Context: He trains a few days a week, so in those two charts the empty days take most of the width.
Decision: An eye, the same size as the range circles and to the left of S, toggles the empty days of Tiempo en el gym and Progreso por ejercicio only. Open eye, the default: every day keeps its slot. Closed eye: only the days with data, one after another, and as many fit at once as the chosen range holds up to today (a week with three sessions shows three bars); sliding then moves one data day at a time. The choice is saved per chart in the `chart_gaps_hidden` setting, like the ranges, and toggling it reopens the chart on today.
Rejected: Counting the range in bars when the eye is closed (the week view would show seven sessions, not a week), and changing how many bars fit while sliding, which a native scroll cannot do smoothly.

## 2026-10-10 — A meal slot picked by hand stays until the clock moves on
Context: At dinner time he logged two things he forgot from lunch; after the first one the chip went back to "cena".
Decision: The slot he picks stays after logging, after eating a batch portion and after coming back from another app. It lets go, and the chip follows the clock again, as soon as the clock's own slot changes or the day changes, so the next morning opens on "desayuno" even if he left "mediodía" picked.
Rejected: Resetting to the clock after every log, the old behaviour, which made him pick the slot again for each forgotten item.

## 2026-10-10 — One food summary card, with calories and protein first and in colour
Context: The top of Comida had a whole card for calories and protein, with the number in poster type and a star, and a second card for the rest; he found it loud.
Decision: One card, "Lo que llevas". Calories alone on the first line, on blue; protein on red, next to carbs, on the second; fat and sodium on the third; glycemic load after them when there is one. Calories and protein are larger than the rest and say, in small type, what is missing for the band or the floor ("faltan 18 para el piso", "piso de 130 cumplido"). The same card serves a past day opened from Registros. Dairy is no longer shown and its daily total is no longer computed; each food keeps its dairy mark, so nothing he recorded is lost. This contradicts SPEC section 7.5 point 2, which asks for a daily dairy total; the spec is unchanged until he says otherwise.
Rejected: Keeping the dairy total computed with nothing showing it, which would be dead code.

## 2026-10-10 — Plan rows slide while reordering
Context: Dragging an exercise in Entreno, the row it passed jumped into the free place in one frame.
Decision: Each row of the order is drawn where its own animated value says, not where the list puts it. While dragging, the rows the finger passes slide in 150 ms to open the gap, on the native driver; on release the dragged row glides from the finger into its place and stays yellow and on top until it lands. The new order is written after every row is already where it belongs, so committing it moves nothing. The lines between rows are drawn apart from them and never move; only the exercise, with its buttons, slides (changed the same day at his request). Changes from outside the drag, like an exercise dropped by the time budget, slide the same way.
Rejected: LayoutAnimation, which animates the list's layout but not the offsets the drag uses, so releasing would jump; and a drag library, which pulls in Reanimated, the cause of the September crash.

## 2026-10-10 — Lifting a plan row redraws only what changes
Context: Touching the grip of a plan row took a moment to lift it. Measured in the browser: about 40 ms from the touch to the yellow row, against 2 ms for the row alone. Turning off the tab swipe redrew the three tab screens (about 30 ms), and turning off the screen's scroll redrew the whole Entreno screen (about 8 ms).
Decision: The swipe lock keeps its state in its own context, read only by the tab pager; the screens that turn it on and off get functions that never change. Each tab's content is built once, so the pager redrawing itself does not redraw the screens. Entreno's scroll switch lives in a small frame around its screen, which redraws alone. The lift now takes about 6 ms in the same measurement.
Rejected: Delaying the locks until after the lift is drawn, which leaves a frame where the native scroll or the tab swipe can take the finger.


## 2026-10-11 — Old sets move to the exercise they were done with
Context: Since the 8 October catalog change each way of doing an exercise is its own exercise, but the sets logged before it with the old equipment buttons stayed on the original one. The cable hammer curl showed his dumbbell sets as "25 lb c/u", and the dumbbell hammer curl showed nothing.
Decision: Migration 061 moves every set whose own implement differs from its exercise's to the member of the same family made with that implement: one not archived first, then the base, then by rank. A set with no such member stays where it is. That session's plan entry moves with the sets only when none stayed behind, the target was not already planned and no other exercise lands on it, so the day still reads "3 de 3 series". The sets of both exercises touched in a session are numbered again by time, because an arriving set 1 can meet an existing set 1. Volume, muscles and stored scores do not change; the pace learned from those sessions is rebuilt. This supersedes "without rewriting historical sets" in the 8 October entry, at his request.
Rejected: A menu to change what each old set was done with (the migration fixes the only source of mismatches, and new sets already land on the right exercise), and leaving the sets in place while every reader matched them by family and implement, which would put that rule in every query.

## 2026-10-11 — Dumbbell weights read per dumbbell everywhere, marked c/u
Context: In Gráficas the hammer curl read 25 lb without saying it was one dumbbell, and the estimated 1RM and the mean weight per rep counted both dumbbells while the top weight counted one, so the mean could read 50 lb over a top weight of 25 lb.
Decision: The top weight, the mean weight per rep and the estimated 1RM, in Gráficas and in the session's "1RM estimado" line, are one dumbbell, the number he writes, and say "c/u"; so does the last set on the rest screen. An exercise's chart says "c/u" only when every one of its sets is with dumbbells. Volume still counts both. This extends the 1 October entry, which already kept the top weight per dumbbell.
Rejected: Showing totals, which doubles the number he reads on the rack and types.

## 2026-10-11 — Preserve the Transit research and eight-phase implementation baseline
Context: The owner requested a personal London, Ontario transit module coordinated with training finish estimates, precise saved doors and walking paths, arrival/departure planning and notifications. After official-data research and challenging the permanent-server recommendation, he requested a detailed session handoff before clearing the chat and proceeding one phase at a time.
Decision: Keep the complete requirements, nine exact places, dated LTC feed/stop/detour evidence, reasoning, alternatives, integration constraints, acceptance criteria, model/effort recommendations and phase ledger in `docs/transit-plan.md`. The preferred baseline is local-first personal data and cached schedules, daily static-data change checks, an on-demand Node/TypeScript HTTPS function on Vercel Hobby for filtered official arrivals/positions/alerts, direct/one-transfer personal planning, side-menu Transit with Hoy/Entreno cards, and local reminders before optional active-trip background location. Separate later phases cover bounded selected-route continuous history, validated personal ETA corrections and native push pending suitable Apple signing/membership. The public portfolio was verified as served by Vercel; account access, quotas and deployment remain unverified. Documentation is authorized; implementation/deployment proceeds only for the phase requested in a future session. SPEC.md remains unchanged and unrelated training/chart work is preserved.
Rejected: Treating the initial permanent Node server as a fixed decision after the use case changed; assuming current bus positions can replace official arrival predictions accurately without evidence; using Hobby's daily cron or GitHub Actions as urgent continuous bus monitoring; making custom ETA authoritative before comparison; claiming free-account native push is enabled because local reminders already work; and adding MapLibre, OpenTripPlanner or a Web Push companion before their additional capabilities justify their operating/integration cost. All three remain documented conditional alternatives, not forbidden future choices.

## 2026-10-11 — Implement only the local Transit foundation
Context: The owner requested Transit phase 1 and preservation of unrelated uncommitted training/chart work.
Decision: Implement the side-menu screen, nine exact editable places and additional manual/map/foreground-location points, stable links to existing gym IDs, nearby stops and cached schedule-only departures, and separate manual directional walking minutes/entrance notes. Migration 062 adds Transit data after the preserved 061 migration. Use Expo-compatible react-native-maps 1.27.2 for Apple Maps and a point diagram for web development. Keep personal places/walks in existing SQLite backups, excluding the replaceable public schedule cache. Bundle the initial whole-city schedule for offline bootstrap, and prepare daily public GTFS checks with Python standard-library tooling and GitHub Actions. Publish a schema-1 compact JSON package/manifest with calendars, exceptions, ordered restrictions, shapes/transfers and SHA-256 integrity; validate before atomic replacement and retain last-good data on failure. Phone updates use HTTPS and send no personal coordinates. Implementation and automated/browser verification are local; native iPhone checks and publication remain pending, as detailed in docs/transit-plan.md section 19.3. SPEC.md remains unchanged.
Rejected: Replacing existing gym points/history; inventing default walking times; treating straight-line distance as a walking route; adding a fourth bottom tab; implementing realtime, itinerary optimization, Training integration, notifications, background location or later phases; publishing or triggering a native build without a publication request.

## 2026-10-11 — Transit live data through an on-demand Vercel function
Context: Phase 2 needed official arrivals, reported buses, the selected trip's stops and LTC alerts without uploading his places and without a broad insecure-transport exception, while LTC serves realtime only over plain HTTP and its trip feed weighs about 1.6 MB. The real feeds on 2026-10-11 contradicted LTC's own schedule: direction 1, or 11, on trips listed as 0; one trip repeated with and without its bus; timetable copies for trips no bus runs yet; and an alert file rewritten only when an alert changes.
Decision: A separate Node 24 project, `transit-live/`, deployed to Vercel Hobby as one on-demand function, reads the three binary feeds and returns only the asked stop, trip and route, joined to the phone's schedule version: trip, route, start time and service date must agree, a contradicting direction is dropped instead of the trip, a repeated trip keeps the copy that names its bus, and two buses on one trip keep neither. An installation key whose hash lives in a Vercel variable, 12 requests a minute per instance and a firewall rate-limit rule, required before it serves, bound its use. The phone keeps the connection in the keychain, reads only while Transit is on screen, keeps the last good reading for 30 minutes outside backups, shows a trip without a bus at its timetable time as "Horario · sin bus asignado", judges alerts by the service's last check, and falls back to the saved schedule on any failure. The app's type check and lint leave `transit-live/` to its own install and tests. It is a second server-side piece beside the Deals ingestion and holds only public feed copies and the key's hash. Details and setup steps are in docs/transit-plan.md section 19.4.
Rejected: Reading the HTTP feeds from the phone, which needs an ATS exception and moves about 1.6 MB per read instead of 6 to 23 KB; rejecting trips whose direction disagrees, which lost half of route 16's predictions; rejecting the whole answer when a trip repeats, which left those stops without live data; judging alerts by their header time, which marked them stale and slowed reads to every 5 minutes; labeling timetable copies as live; installing the service's dependencies in the iOS build to keep its tests in the app; and uploading the service from this computer, which would skip the GitHub redeploys that keep its schedule in step with the phone's.

## 2026-10-11 — Private places stay out of the public repository
Context: The Transit commit pushed on 2026-10-11 seeded three private places, his home and two workplaces, with addresses and exact coordinates in a migration and two tests, and the plan that was about to follow lists them again. The repository is public.
Decision: Only the six public places (both gyms, Costco, Food Basics, the cinema door and the Masonville door) are seeded; he adds the three private ones in Transit, where they stay on the phone and in his backups. The commit was rewritten and force-pushed the same day, and the iOS build made from it was deleted. `docs/transit-plan.md` stays local, like SPEC.md, because it records those places and the stops around them.
Rejected: Leaving the places public, and removing them only from that point on, which would have kept them in the visible history.

## 2026-10-11 — The bus is placed by its GPS and the predictions, in a trip card like Google Maps
Context: On his phone the trip detail put a route 4 bus at his stop, then four stops past it, while Google Maps showed it two stops away. LTC's vehicle feed reports a current stop one to seventeen stops ahead of the bus (measured on three route 4 buses that evening), and the detail trusted it. Opening a departure also pushed the screen down when its alerts arrived, and the stop list was long to scroll.
Decision: The bus is drawn between the two stops its reported position falls between, searched around the first stop LTC still predicts ahead of now; without a usable position (none, old, or more than 400 m off the trip) the predictions alone place it, drawn as an estimate. LTC's current stop number is no longer read. Opening a departure folds the list and the date controls into one card: tabs with the previous and the next five departures of that line at his stop, a vertical line with a dot per stop (faded before his stop, a bigger dot at it), two lines per stop (name and time; passed, live with minutes and punctuality, or schedule), the bus icon on the line, eight and a half rows tall with its own scroll, opening on his stop. Alerts move to the end of the stop card, folded into one line. Places carry one of twenty icons (migration 063, a pin by default, the six seeded places with theirs) drawn on the map, and buses are always drawn as a bus. Route colors come later.
Rejected: Reading LTC's current stop as "heading to" (it still ran up to seventeen stops ahead); moving the bus smoothly between reports, which would draw positions nobody measured; and a separate screen for the trip, since he wanted it inside the stop card.

## 2026-10-11 — One Paradas card with useful stops, line colours and status icons
Context: Nearby stops listed every stop around a place, several serving the same line in the same direction, and the stop card below repeated "En vivo LTC" and other words on every departure. He is colour-blind and asked for LTC's line colours, deepened, for icons with a legend instead of words, and for a compact day and time picker.
Decision: One "Paradas" card: the day and time picker and the live refresh on top; up to six nearby stops, each adding a line or a direction that no closer stop serves, the rest behind "Ver más"; a stop opens in place with its departures grouped by line and direction (the one just gone, the next three, the rest behind "Ver más"), and a departure opens its trip card there. A row reads the time, the line's badge (its number on LTC's colour with saturation raised and lightness capped at 40 %, black or white ink by contrast) and icons: a pulsing red dot for live, a crossed bus next to it when LTC is live but no bus is assigned yet, a crossed grey dot for timetable or an old report, and icons for cancelled and skipped; a second line keeps the minutes, the timetable time and the report age, and says "mañana" or the day when it is not today. A folded legend explains the icons. The schedule package moves to format 2 with LTC's route_color; a phone holding a format 1 package takes the one the app ships, and the daily bot republishes when only the format changed. The trip card and the map line take the route's colour.
Rejected: The date picker he linked, which is a web component and cannot render in the app; a separate screen per stop; and colours typed into the app, when LTC already publishes them and the bot keeps them current.

## 2026-10-11 — Plan direct and one-transfer trips locally, with labeled walking estimates
Context: The owner requested only Transit phase 3 over the published places, stops and live service. An exhaustive combination search took seconds in a desktop Hermes prototype. He approved the standard estimated margins, directional stop-to-stop walking storage and deferring per-journey line preferences; the implementation's final checks were completed on 2026-10-12 UTC.
Decision: Add a local "Cómo llegar" card for saved origins/destinations, now, depart-at and arrive-by, sorted by arrival at the door. Use an indexed, cancellable search for direct or one-transfer journeys: 600 m access/egress, 400 m transfer candidates plus saved links, a 90-minute first-boarding window for departures, a three-hour search horizon and a pool of 120 itineraries for live re-ranking. Yield between stop tasks with an 8 ms target, not a guaranteed maximum. When no personal minutes exist, label estimates computed at 4.5 km/h over 1.3 times straight-line distance, rounded up; allow 2 minutes before boarding, 3 minutes after a transfer walk, mark transfers with less than 5 free minutes as tight, and reserve 3 minutes before an arrival deadline in the scheduled plan. Saved directional minutes override estimates. Migration 064 adds `transit_stop_walk` to local storage and personal backups without editing shipped migrations. Show the next scheduled connection when one is tight or lost, reuse existing trip cards, line colours and live semantics, and combine live requests with Paradas inside the existing eight-stop limit and refresh policy. Walk-only within 1.5 km is explicitly estimated and has no verified path. This narrowly supersedes the phase-1 rejection of default walking minutes; no estimate is represented as a measurement. Route preferences remain deferred. Private coordinates stay on the phone and in the private input file; verification scripts live outside the repo. Detailed bounds, measurements, confirmed timetable connections and unverified physical paths are in the local plan's section 19.5. Publication and phase-3 iPhone validation remain pending.
Rejected: An exhaustive full-feed search that blocks the screen; treating proximity as a verified crossing or indoor exit; saving estimates as personal observations; merging forward and reverse transfer walks; inventing a route with two transfers; adding a separate live polling loop, changing Vercel limits or starting Training/reminder/tracking work in this phase; and committing or pushing without the owner's permission.

## 2026-10-12 — Follow the bus through app switches, with its last report and a bounded estimate
Context: On his phone the trip card's bus vanished for several seconds after switching to Google Maps, its stops turned to "Última predicción", it came back about two stops on, and the map showed other route 17 and 04 buses but not his, 3511. Reproduced on the published code: the service dropped every bus whose current stop and sequence contradict its trip (26 to 29 of 66 buses on 2026-10-12, 3511 among them on 2026-10-11); the card's clock, stopped in the background, made a reading taken after the return look like it came from the future; a report counted as old once 90 s had passed on the display clock, although LTC writes every 30 s, the service may reuse its copy 30 s and the phone reads every 45 s, so buses flipped to old reports without leaving the app; the planner's stop changes cleared the reading; a prediction LTC left on a passed stop pulled the GPS search back 20 stops on route 7; the planner judged live data against the start of the minute; and the line and the map used different evidence.
Decision: The service keeps such a bus and drops only its contradicting stop fields, still counted. A report counts as current while it was under 90 s old when read and that reading is under 90 s old; the clock is read in the event that wakes the app and right after each reading. The last reading stays on screen across query changes, and a stop it did not ask about reads as schedule. A followed bus that a new reading leaves out keeps its last GPS for five minutes, with its own time and never as current, unless its trip is cancelled, another bus is named for it, or that bus reports another trip. Without a current GPS but with current predictions the bus is estimated: it leaves the previous stop with the predicted delay, moves with the clock along the trip's drawn path, reaches the next stop at its predicted time and waits there; it never passes that stop, ends with the predictions, is drawn dashed and is labeled as an estimate, never as GPS. The line and the map draw the same bus at the same point; on the map it is larger, white with a black ring (grey for a last report, dashed for an estimate) and tagged with its number and source. Tapping it on the line, or its status text, scrolls the screen to the map and moves the camera there once, without moving the stop search centre or following it afterwards. A GPS more than 400 m off the trip, one that contradicts the current predictions, or the bus still on its previous trip is shown on the map and explained, not drawn on the line. Reads continue until 15 minutes after the followed trips' timetable end; trouble in one LTC file no longer slows reads; a return from another app retries at once unless the service asked to wait. This narrowly revises the 2026-10-11 rejection of smooth motion: the estimate may move between stops by the clock, while a reported GPS position is still drawn where it was reported and never moved. Details, measurements and pending phone checks are in the local plan's section 19.6.17.
Rejected: Moving a GPS report past its own position or an estimate past the next stop; animating corrections between reports; keeping an estimate for the 30-minute cache horizon; learning dwell or traffic by day and hour now (phases 6 and 7); widening the 30 s allowance for data from the future; removing the other buses from the map; following the bus in the background (phase 5); and accepting the holiday trips LTC runs outside its own static calendar, which needs its own decision.

## 2026-10-12 — List every bus he can take, one option per first bus
Context: On his phone, a trip from home to his gym listed three buses, while Google Maps also listed a bus on another line that leaves a minute before one of them. Reproduced on the published planner with the same weekday timetable Google used: that bus was found but hidden because the other line, a minute later, arrives two minutes sooner, and the 120 options kept for live data filled with other stops to get off and other first buses to reach the same few buses (49 distinct buses in 120 entries), so only three options survived. The phone's schedule carries all 8,705 trips and 38 lines of LTC's file.
Decision: The planner lists one option per bus he can take first. An option is hidden only when another with no more buses leaves no earlier and arrives no later on the same first bus, the same last bus or the same lines; a transfer also goes when such an option arrives 10 minutes sooner, or when it buys less than 10 minutes of leaving later than an option with fewer buses. A direct bus is never hidden by another line or by a transfer. Before the options are kept for live data, getting off the same bus at another stop, or reaching it on a first bus when he can walk to it and leave no earlier, counts once, and every listed option is kept even past the first 120. "Ver más" shows all of them. A brute-force search over his nine places, three days and six times (1,008 searches) found no bus missing; 14 searches list one option more than a full comparison would. This revises the 2026-10-11 phase-3 rule that kept only the options no other one beat. Details are in the local plan's section 19.5.1.
Rejected: Hiding a direct bus that another line beats by 10 minutes, which hid 693 of the 6,197 direct buses between his places (one a 20 leaving a minute earlier and arriving 12 minutes later); and keeping the published rule, which hides the bus Google Maps shows.

## 2026-10-12 — Transit opens on where he is, and places are picked from a searchable list
Context: Choosing places among chips was slow, and he asked Transit to read his location on entry like Entreno does, without its 400 ms wait, and to start from the place he is at.
Decision: Entering Transit reads the location once, at once: the phone's last position under a minute old and within 100 m, otherwise one balanced reading, with no message when it fails or lacks permission. The nearest saved place becomes the one shown in Tus lugares and the trip's start in Cómo llegar, unless he picks one after the reading was asked for; each later visit reads again. Tus lugares, Desde and Hasta use the dropdown with search from exercise progress, each place with its icon, found by name or tags with the food search. Places gain comma-separated tags and an optional importance from 1 to 10 (migration 065): lists start at 1, and places without one go last, by name. Creating or editing a place opens a sheet over the screen like a new food; choosing the point on the map puts the sheet away until Listo. One more map icon, a leaf.
Rejected: Ordering places by how often he goes there, since he chose importance; a map inside the sheet; and keeping the 400 ms wait, which only spares a reading when Entreno is crossed by accident.


## 2026-10-12 — Read Training finish times for the next trip and keep local reminders separate
Context: The owner requested only Transit phase 4 over published phases 1–3 (`a03d0b4`), allowed clearly preferable defaults without another approval, and required Transit notifications to coexist with health and creatine. The existing health scheduler cancelled every pending notification. He also authorized showing actual LTC holiday buses when available, retaining scheduled fallback otherwise.
Decision: Expose Training's existing remaining-work calculation and its initial/mixed/limited/learned evidence through `training/read.ts`, without changing the timing algorithm, sessions, sets or routine. Today and Training share one locally saved next journey, with its next feasible bus, latest workout finish, departure time and alternative. Add 5 editable preparation minutes before the existing walk and 2-minute boarding allowance; preparation must exclude any indoor exit already included in saved walking minutes. Arrive-by retains the planner's 3-minute destination margin. Two local alerts are opt-in per selected journey: prepare at the latest finish and leave at departure, normal optional sound, separate preparation/leave switches, optional 21:30–07:30 quiet hours off by default. Transit does not spend health's daily cap or inherit its master switch, recent-use suppression or ignored-nudge silencing; creatine keeps 11:30/22:00. A serialized coordinator replaces only a module's changed requests, recognizes legacy health IDs, preserves unknown owners, and reserves two Transit slots. Migration 066 stores the journey/preferences and a per-event consumption ledger in personal backups. Forecast changes reuse stable event IDs; fired events do not repeat, while explicitly choosing an alternative creates a new journey. Notification taps open Transit and recompute the saved trip, showing an outdated-notice warning when appropriate. Foreground cards share the existing live client policy; suspended/closed notifications retain the last programmed calculation. Known, explicitly dated/timed LTC trips with a physical bus and fresh evidence may be shown outside the static service calendar, individually, with scheduled fallback preserved. An optional query capability keeps those exceptions out of replies to the published phase-3 app. This narrowly supersedes the holiday rejection in the earlier continuity decision. No dependencies, native entitlements or remote push were added; SPEC.md is unchanged. Native notification delivery, sound, Focus behavior and tap routing remain iPhone checks in the local plan's phase-4 handoff.
Rejected: Recomputing or shortening Training to fit a bus; global notification cancellation; automatically arming every suggested trip; repeating an already consumed event after each delay; treating a missing or stale holiday report as permission to activate an entire service calendar; continuous location, boarding inference, active-trip tracking and background live updates (phase 5 or later).

## 2026-10-14 — Follow explicitly started trips and learn only reviewed directional walks
Context: The owner requested Transit phase 5 over the published planner and local reminders, then requested completion of its unfinished UI, native configuration, checks and handoff while preserving the existing work.
Decision: Only “Salgo ahora” starts continuous location. Freeze the selected itinerary, stops, geometry and schedule identity locally so walking, waiting, riding, transferring and the final walk survive app switches and retain offline context. Use route-aware, repeated GPS evidence for boarding, label uncertain matching, and keep manual boarding, alighting and corrections available without permission. Completion, cancellation and expiry stop location and clear only trip notifications; reconcile on return, retry failed shutdown and report it visibly. iOS uses foreground-initiated When In Use location with the blue indicator and the location background mode, through the installed Expo location/task-manager modules. It does not request Always permission or promise delivery after force-quit. Background live reads are driven by location callbacks, at most once per minute, and require the frozen schedule identity to match. Health, upcoming-journey and active-trip notification owners remain separate, with two pending slots reserved for each Transit owner. Migration 067 stores the active trip, reviewed walk observations, crossing notes and directional paths; migration 068 persists consumed trip warnings so dismissal, restart or a delayed prediction cannot repeat them. An explicit boarding correction creates a fresh warning version. Walks are offered for acceptance or exclusion with timing, GPS quality, trace and unusual-speed evidence; the median of the latest ten accepted samples applies only after three in that direction, with typed minutes always taking priority. Crossing waits are already inside walking totals and are never added again. Saved paths can be drawn, corrected or derived from a reviewed trace, preserving turns and retraced segments. Indoor departure evidence remains approximate and visible; preparation must exclude any indoor time already measured in the walk. No personal coordinates are sent to the live-data service. SPEC.md is unchanged; screen-lock delivery, native maps, notification interaction and battery use remain explicit iPhone acceptance checks in the phase-5 handoff.
Rejected: Starting a tracker from merely viewing Transit or a gym; global notification cancellation; treating one fast/noisy sample as a new walking habit; automatic clustering of path variants without reviewed evidence; claiming an offline basemap or new LTC knowledge while offline; exact signal countdowns; continuous route history, learned bus forecasts or remote push from phases 6–8.

## 2026-10-14 — Partial live readings must not invent faster transfers
Context: A field report described an unnecessary ride past a useful alighting stop, a return transfer, ambiguous adjacent route badges, and alerts for unrelated routes or stops beyond the destination. The exact historical live reading was unavailable. A controlled reproduction showed that the planner combined a delayed boarding prediction with the original timetable at an unqueried transfer stop, sometimes reaching the transfer before boarding.
Decision: Within each planner refresh, share one ordered timeline per trip and service date. Carry a fresh reported delay forward to stops without predictions and reject backwards time between reported stops, labeling the derived times as estimates rather than official predictions. A later coherent prediction replaces the estimate; stale reports do not create new delay estimates. Recheck the boarding margin after replacing a missed connection. Ordinary departure browsing retains its existing schedule fallback. Filter the alert panel by the frozen remaining rides, otherwise the selected next journey, otherwise the browsed stop; respect route, direction, trip, service date, active periods and only the traveled stop segment. Keep the ticking journey context inside the alert child rather than the full Transit screen. Show an arrow between route badges and an explicit direct/transfer label. Existing frozen trips remain frozen; the corrected planner applies when selecting a new trip.
Rejected: Hardcoding a particular route or alighting stop; presenting a derived time as an LTC prediction; showing every alert returned for the broader map/departure query; claiming an exact replay without the historical reading. No service deployment, database migration, new dependency or personal route fixture is needed.

## 2026-10-16 — Leaving now, search late buses and list the one he just missed
Context: On his phone, "Cómo llegar" from home to his gym listed first a bus several minutes later than one the stop card and Google Maps showed. Reproduced on the published planner with the cached weekday timetable: the missing bus was due a minute before the timetable let him reach it and was running late, and the search discarded it by its timetable time before live data could say so, so a late bus he could still catch never appeared, even five minutes late. Separately, the search compared leaving times to the second while the list allows leaving within the current minute, so about 7 in 100 searches between his places dropped the bus to leave for right now. With the timetable alone, a brute-force comparison over ten of his trips through a weekday found no other missing bus. He also asked to see, for reference, the one bus he just missed.
Decision: Leaving now, the planner searches buses the timetable has leaving up to 30 minutes before the request, and live data decides whether he still makes them; the schedule's listed options still start at the request, within the minute. The trip saved from "Salir ahora" is searched the same way, so a late bus he chose is found again. The list opens with exactly one more bus, dimmed and not selectable: the last to leave among those he no longer makes that would be listed beside the others, marked "pasó hace N min" when it already left his stop and "probablemente no llegues" when it has not but he had to leave already. An option that says "sal ya" can be chosen until a minute after its leaving time. With a chosen departure or arrival time nothing changes. Leaving now, the search does about a fifth more work, still about 3 ms on desktop.
Rejected: Lowering the approved walking estimates or boarding margin, which would also list buses he cannot make; listing every bus that already left; querying live data before the search, which needs the search's stops first.

## 2026-10-16 — The trip in progress gets its own map, and choosing a trip leaves Cómo llegar alone
Context: During a trip he wanted to see on a map where he is, his bus and his line, and was unsure whether the line stayed drawn. The only map following a trip was inside Explorar, which drew just the current bus's line among every stop, bus and place; the Cómo llegar map drew the chosen option only while it was still listed, so it vanished about a minute after his leaving time. Separately, tapping «Elegir este viaje» rebuilt the whole Cómo llegar card because it was keyed by the saved trip: the list went back to a spinner, the map was recreated and its stop, place and trip filters reset.
Decision: On Transit, the «Viaje en curso» card draws the trip alone on its own map from the frozen trip, so it lasts until the trip ends: each bus in its line's colour, the walks dashed, a small white dot per stop, a grey dot where LTC's live data says the bus skips the stop (the same signal the trip timeline uses), a larger white dot where he gets off, his bus placed as on the trip card, and the phone's own blue location dot. Buttons fit the whole trip again, or centre on him or on his bus. Today and Training keep the card without a map. Choosing a trip in Cómo llegar no longer rebuilds it: the option turns green with a check and «elegido» at once and says where «Salgo ahora» is; a trip chosen in Today or from a notice still replaces what the planner shows.
Rejected: Drawing the trip from the planner's options, which disappear once he has left; colouring dots alone to tell closures apart, since he is colour-blind (size and fill differ too); reading stop closures from alert effects, which nothing else in Transit does yet.

## 2026-10-16 — Transit is organized around the chosen trip
Context: He found the Transit screen cluttered: a trip could be planned in two places (the «Próximo viaje» form and Cómo llegar), two maps carried layer checkboxes, the walking form was always open apart from its stop, and the schedule's technical details sat at the bottom. Of the two proposals, a trip card on the screen or a separate trip popup, he chose the card.
Decision: On Transit the top card, now «Tu viaje», appears only once a trip is chosen and is changed by choosing another option in Cómo llegar; Today and Training keep their own form. While a trip is in progress, Cómo llegar and Paradas fold to one tappable line each and the walk review is hidden, so the trip card with its map is the screen; the folding resets with each trip and the folded stop leaves the live query. The Cómo llegar map draws only the two places, the open option and its bus, without checkboxes; the layers stay in Explorar. «Tu caminata» opens from a button inside the open stop, which shows the saved minutes. «Horario guardado» moved into the connection panel, renamed «Conexión en vivo y horario». The trip card's size changes slide with `LayoutAnimation` when a trip is chosen, starts, changes step or ends, and when a folded section opens.
Rejected: A separate popup for the trip, one more layer to open and close over Explorar, which is already a popup; keeping folded sections mounted, which would keep the planner's map and searches running during the trip.

## 2026-10-16 — Leaving now, Cómo llegar starts where he is and offers the three nearest stops
Context: He asked Transit not to depend on saved places: from wherever he is, he gives a destination and the app says how far and which way to walk to the nearest stops with a bus that takes him there, the three nearest even if far, a nearby stop LTC has closed in grey, the stops numbered on the map with a legend, a small window on a tapped stop to look at its lines (each opening its whole route with the bus, as in Paradas) or to pick its buses, and once a bus is picked the walk drawn from where he is, updating as he walks. Estimated walks unless he saved his own. He also proposed a simulation sandbox (joystick location, boarding a bus, shifted clock); after hearing that it hides the live-data and GPS problems the field reports came from, while costing the most code and putting his real reminders at risk, he asked for the stop flow plus a start chosen on the map instead.
Decision: «Desde» defaults to «Tu ubicación», the reading taken on opening Transit; within 60 m of a saved place it counts as that place, with his walks from it. «Desde» also takes a point tapped on the map; «Hasta» takes a saved place, a point on the map, or an address found by Apple's geocoder through expo-location (the typed text goes to Apple; matches beyond 40 km of London are discarded). With «Salir ahora» the list becomes the stops he can board at, nearest first, each judged on its own buses so a quicker bus from another stop does not hide it; the first three are numbered and coloured on the map (number inside, a cross on grey for closed). Fewer than three widens the search from 600 m to 1.5 km and then 3 km (about 20 ms per search at 3 km on desktop over the bundled schedule); no stops near the destination widens the egress the same way, in every mode. A stop reads as closed when an active LTC alert names it with NO_SERVICE or STOP_MOVED, or with "closed"/"closure" in its text, or when every bus LTC reports there skips it; a closed stop is excluded from boarding and getting off, so the next stop on the line takes its place, stays in the live query so it reopens when LTC says so, and is listed in grey with the alert's words. Tapping a stop opens a window over the map with Ver (its lines that take him there, each opening the existing trip timeline while the map draws that route and bus) and Elegir (its buses, with the one just missed first). «Salgo ahora» on a bus starts the followed trip at once from where he is, without saving a next trip; «Elegir este viaje» stays when both ends are saved places; a start tapped on the map is look only. Trip ends that are not saved places are frozen as points: they finish the trip on arrival and teach no walk. The walk in progress is drawn from his last GPS reading to the stop, along his saved way when he has one, and the trip card says the metres and minutes left and the compass direction. «Salir a las» and «Llegar antes de» keep the list by bus.
Rejected: The simulation sandbox, for now; street-by-street walking directions, which need an outside routing service, so the walk is a straight dashed line unless he saved a path; reading DETOUR alerts alone as closures, since detour alerts also name stops that stay served; listing more than three open stops.

## 2026-10-17 — Leaving now, the three stops are ranked by what their best bus costs, not by distance
Context: The nearest stop came first even when its bus arrived 35 minutes later than one from a stop a little farther, and each row showed the next bus to leave rather than the best one.
Decision: Each bus gets a cost in minutes: the minutes until he arrives, plus 7 per transfer, 3 more for a tight one, 1 per minute on foot (walking counts double, since it also delays the arrival) and 0.25 per minute from his door to the destination, so waiting at home beats waiting at a stop. A stop is worth its cheapest working bus, the list and the map numbers go cheapest first, and each row shows that bus with whether it is direct. The weights are shown under the list. The origin picker drops "Tu ubicación" for a button beside it.
Rejected: Ranking by arrival alone, which sends him on a 24-minute walk to skip a transfer that arrives at the same time; walking at half weight, for the same reason; widening the search past 600 m to look for better stops when three are already near, which costs search time for walks the cost rarely favours.

## 2026-10-17 — Reanimated comes back, pinned to the version Expo SDK 57 ships with
Context: He wants to redesign the look, and the lighter styles he is weighing lean on Reanimated for motion. It was kept out because it crashed the app on 2026-09-21, but that crash was a version mismatch: `react-native-keyboard-controller` pulled Reanimated 4.7, whose `react-native-worklets` 0.13 is outside the 0.7 to 0.10 range `expo-modules-core` supports. He asked to settle that before any redesign.
Decision: `react-native-reanimated` 4.5.1 and `react-native-worklets` 0.10.1, the versions `npx expo install` picks for SDK 57, pinned exactly so npm refuses a library that wants another one instead of installing it. `babel-preset-expo` adds the worklets plugin on its own, so there is no Babel config. Nothing uses it yet; `index.ts` imports it so its runtime starts at launch and the first IPA proves it on the phone. That import goes when a screen uses Reanimated.
Rejected: Waiting for the redesign to install it, which would mix a startup crash with half-done screens; keeping caret ranges, which let a later install drift past the supported worklets range.

## 2026-10-18 — The look becomes dark glass, with real Liquid Glass only on what floats
Context: Neobrutalism felt heavy even in pastel. He compared five mockups of Hoy and picked D: a warm dark background with colour blobs, translucent cards and iOS 26 glass. He also wants to choose each screen's background himself later (a colour, a gradient or a photo), to see what keeps the numbers readable.
Decision: One dark palette in `src/ui/theme.ts`: translucent cards with a light edge, light text, one amber accent, dark ink on every filled colour, Plus Jakarta Sans in place of Nunito and Archivo Black, capsule buttons and no hard shadows. Real Liquid Glass (`expo-glass-effect` at the SDK 57 version, no Reanimated) goes only on what floats (the tab bar, the side menu, the assistant ball and the top bar buttons), as Apple's clear glass in its light variant with a fixed 22% dark tint: the frosted dark variant turned almost black over a bright photo. Where iOS does not draw it, a translucent fill. Sheets, bubbles and alerts that float over content are opaque. The background is drawn by every stack screen, opaque, in two slices cut at the top bar's fixed height so they meet without a seam; the tab pages are transparent and slide over it. The score palettes run from dark to bright on the dark background, which changes spec 4.5 with his approval and replaces the 2026-09-30 rule that they stay untouched; a test checks that every step is brighter than the one before. The system appearance is dark. Next: per-screen backgrounds in Ajustes, then the remaining screens one by one.
Rejected: Glass on every card, as in his reference images, because Apple keeps glass for the floating layer and over a smooth background a translucent fill looks the same at no cost; React Navigation's native tab bar, which needs react-native-screens 4.30 while SDK 57 ships 4.26 and would drop the swipe between tabs; a single background behind every screen, because a transparent pushed screen shows the one below through it while it slides in; keeping the light score palettes, whose best score nearly disappears on dark.

## 2026-10-18 — The tab bar borrows iOS's own selector, and each screen gets the background he picks
Context: He wanted the tab bar to behave like Apple's (a glass bubble that slides to the tab and turns into a lens when a finger drags across it) without losing the swipe between Hoy, Entreno and Comida. He also wanted to choose what sits behind each screen, a colour, a gradient, blobs or one of his photos framed by dragging and pinching, to try which keep the numbers readable.
Decision: Our bar stays, with iOS's segmented control laid inside it, invisible (its titles are transparent but still read by VoiceOver), and the app's icons and labels drawn on top without taking touches, the trick UnionTabView uses; iOS 26 draws the bubble and the lens. One setting, `backgrounds`, maps screen names, and `*` for the general one, to a background. Photos are copied into the app's documents, kept whole and framed at draw time from a centre point and a zoom, with darken and blur on iOS's own sliders; copies no background uses are deleted on save. The three tabs blend their backgrounds with the pager's position while swiping. Ajustes opens Fondos, a list of screens: tapping one opens that screen with an editor panel at the bottom, so the background is tried on the real screen (the general one on Hoy), and a photo is dragged and pinched right there. Touching the tab bar, the editor or the grid turns off the pager and the side menu, through one shared touch lock. Every plain card darkens what is behind it by 25%, and over a photo it draws its own copy of the piece of photo it covers, blurred 12 points more than the background (30% of the slider), at a quarter of the size and scaled up, lined up with the screen and moved by the scroll on the native thread. The app draws it rather than iOS because each iOS 26 attempt failed differently: expo-blur's partial strength only darkened, Apple's frosted glass came out milky grey, and its dark glass black. Checked in the browser: after a 300-point scroll the cards moved and their copies stayed exactly on the photo.
Rejected: React Navigation's native tab bar, which 7.20.0 makes possible with the installed react-native-screens and would be Apple's exact bar, but drops the swipe that follows the finger; a hand-made imitation of the bubble, which never matched; the photo picker's own crop, which iOS keeps square; a small preview inside Fondos, which was not the real screen; preset chips for darken and blur; typing colours in hex, since sixteen swatches cover it.

## 2026-10-18 — Popups blur the screen behind them, and every sheet is opaque
Context: He saw the popups ("Alimento nuevo" and others) look see-through: the food, recipe and pantry sheets were still translucent cards from the redesign, against the rule that what floats over content is opaque, and the 72% dark veil behind every sheet did not blur anything.
Decision: The food, recipe and pantry sheets are opaque like the others; the recipe and pantry forms now use the shared popup sheet, so a long one scrolls inside it. On the phone, opening a sheet takes a snapshot of the screen's content with `react-native-view-shot` (5.1.0, the version `npx expo install` picks for SDK 57, included in Expo Go), at a quarter of the size, and the app blurs it by 20 points with the image's own blur, the same path as the card frost; over a photo background the photo is drawn again blurred behind it. In the browser the blur is CSS `backdrop-filter`, because the library's web capture paints the transparent parts white. The veil drops from 72% to 50% so the blur shows. A new snapshot is taken each time a sheet opens.
Rejected: expo-blur and iOS glass behind the sheets, which already failed on his phone for the cards; React Native's own `filter: blur()`, which on iOS sits behind an experimental flag that is off; blurring only the background without the content, which would hide the cards behind the sheet instead of blurring them.

## 2026-10-18 — The assistant ball can be put away beside Ajustes
Context: He wanted the floating ball out of the way when he is not using it, without losing it for good.
Decision: While the ball is touched or dragged with the chat closed, a small dashed circle labelled «Guardar» appears in the top bar of Hoy, Entreno and Comida, left of Ajustes; it turns solid amber when the ball is over it. Dropped there, the ball shrinks to the top bar's button size, stays in that spot and is drawn on no other screen. A tap on it does nothing; it comes out only by dragging it away from the circle, which can only happen on those three screens, and then it goes to the nearest side as after any throw. The choice is the `assistant_docked` setting, so it survives closing the app. The top bar keeps the spot reserved even while the ball is loose, so Ajustes never moves. Until the settings are read the ball is not drawn, so a put-away ball never flashes at the side on launch.
Rejected: Putting it away from any screen, since the circle sits beside Ajustes, which only the main screen has; opening the chat with a tap on the put-away ball, since he asked for it to come out by dragging.

## 2026-10-18 — Transit audit phase 1: buses counted from when they arrive, every stop on its own buses, a chosen bus kept until it leaves
Context: He asked for phase 1 of the local Transit audit (planner and data accuracy, not missing a bus). Checked against the bundled LTC timetable with public places and against LTC's live alert feed of 2026-10-18: the planner read alighting from the time a bus leaves a stop where it waits to keep its timetable, so arrivals showed up to 5 minutes late and good transfers read as lost even without live data (46 rows over 1,344 searches); an option the list hid could still hide another first bus (351 rows missing); leaving now, a stop on the same line as a nearer one lost all its buses to it, so the search widened to 1.5 and 3 km in 48 of 224 trips; the "Es hora de salir" reminder was cancelled the moment the preparation reminder rang while he was still training or had just finished, and a tap a few seconds after it rang read as an old calculation; and LTC's detours name a stop they still serve, often the temporary one, while their text says other stops are closed, so three replacement stops read as closed.
Decision: Getting off, and every stop past the boarding one on a trip in progress, uses LTC's arrival prediction and the timetable's arrival; boarding keeps the departure. Only options that are listed can hide others. Leaving now, the search keeps the best way from each stop he can board at, so the next stop down his line is a stop of its own; a first bus to a bus he can walk to from any stop and leave no earlier still does not count, the pool's 120 buses count once however many stops reach them, and the backup after a lost connection is worked out once per search. The global lists ("Salir a las", "Llegar antes de", Tu viaje) still show one option per bus. Widening fell to 18 of 224 trips; a search costs about 7 ms instead of 5 on desktop Node, the three-stop list about 1.4 ms per refresh (not iPhone measurements). A bus he chose stays feasible from its preparation time until a minute after its leaving time, with "Vas con menos tiempo de preparación del habitual" when preparation falls short, so both its reminder and the trip card hold; an automatic choice still needs the full preparation. A reminder tapped within a minute of its time is current, judged once when the screen has read the saved trip, and the "cálculo anterior" note goes away when he chooses another trip or starts one. A DETOUR alert closes the stop it names only when its header says so ("STOP CLOSURE"); NO_SERVICE and STOP_MOVED still close it, and other effects still read the description. This narrows the 2026-10-16 closure rule; phase-4 reminders otherwise unchanged.
Rejected: Removing the widening when fewer than three stops remain, which the three-stop design needs; requiring "stop" near "closed" in detour text, which LTC's "The following stops will be closed" still matches; dropping the preparation check for buses he did not choose; widening the reminder expiry itself, since the tap's one-minute grace already covers it.

## 2026-10-18 — Transit audit phase 2: Listo back in Transit and the dark glass fixes
Context: He asked for phase 2 of the local Transit audit. Transit's two top bar buttons replaced Listo, and Transit turns off the back swipe so its map can pan, so once inside there was no way out but the side menu. Several Transit pieces kept translucent colours from before the redesign, so the route line showed through the stop dots and the stop popup, and the live bus icon was cream on coral.
Decision: A screen's top bar buttons go beside Listo, never in its place, and Transit drops the date from its bar because three buttons left it two lines. Things drawn over a map or a coloured line are opaque (`surfaceSolid`); ink on a filled colour is dark. Dashed walks on the Apple map are cream, since the app forces its dark style; the web diagram keeps near-black.
Rejected: Locking the whole top bar while a Transit sheet is open, since switching between Explorar and the live panel from there is useful and Listo behaves the same on every screen; changing the walk colour in `map.ts`, which would hide walks on the light web diagram.

## 2026-10-18 — Transit audit phase 3: sheets above the keyboard, stops from Explorar and one-tap stop buses
Context: He asked for phase 3 of the local Transit audit. When the keyboard opened over a popup sheet, the sheet only shifted up to the top padding without shrinking, leaving the bottom fields and «Guardar lugar» under the keyboard. Tapping a stop in Explorar outside the 16 stops nearest the place left Paradas with no open stop; picking a point on the map reset the camera zoom to 0.012 on every tap; starting at «Tu ubicación · <Lugar>» disabled the swap button; `nearestPlace` had no distance cap, so away from saved places Paradas still anchored to the closest place kilometres away without saying which; «Ver recorrido» on an accepted walk could not save its path until manual minutes existed; and leaving now framed the whole city before a bus was chosen and made a list tap go through the map popup.
Decision: The active overlay frame and `PopupSheet` cap their maximum height by the space left above the keyboard and shrink with `flexShrink: 1`, so the sheet's scroll reaches every field and its footer stays above the keyboard. `Paradas` prepends any stop selected in `Explorar` that is outside the nearby list, and `Explorar` offers «Ver salidas de esta parada» to jump straight there. Entering «Elegir en el mapa» freezes the camera center while picking so taps move only the pin. `nearestPlace` takes an optional distance cap (150 m on `TransitScreen`, 200 m on `Hoy`'s «Detectar»); away from saved places `Paradas` anchors to «Tu ubicación» and names its anchor at the top with one-tap chips. Swapping works from «Tu ubicación · <Lugar>» by putting that saved place as the destination, and `StopBuses` distinguishes a map-point destination from a map-point origin. `TransitPersonalMap` includes accepted walks with their learned or measured minutes so «Guardar camino» can seed the walk row. In «Salir ahora», tapping a stop row in `StopList` opens its buses directly while map markers keep `StopPopup`, and `TransitPlanMap` frames the origin and candidate stops until an option or line is opened.
Rejected: Removing `StopPopup` altogether, since on the map a marker tap still benefits from the compact summary before leaving the map; auto-picking a saved place kilometres away when «Detectar» runs on `Hoy`.

## 2026-10-18 — Transit audit phase 4: one timetable in memory, and Tu viaje searches only when it needs to
Context: He asked for phase 4 of the local Transit audit (speed, memory and background work), after phase 3, which the audit had suggested doing second; phase 3 changed nothing phase 4 depends on. Each visit to Transit read the 4.6 MB timetable from SQLite, parsed and checked it (30 to 37 ms on desktop Node, more on the phone) and handed out a new copy, so the stop and planner indexes were built again and Tu viaje kept a second copy; a downloaded timetable was parsed twice. Leaving now, Tu viaje read his walks (four statements) and ran a full citywide search every minute, even during a trip in progress, and a restored backup left it with the old trip and places until the app went to the background.
Decision: Each open database keeps the timetable it last parsed with its checksum; reading it is one statement for the checksum and dates, and the package is parsed again only when the checksum changes. A download and the bundled first copy are parsed once. The planner and stop indexes are built once per timetable and shared by every screen. Leaving now, Tu viaje judges the buses it found again every minute from the live times and searches again only when its search is ten minutes old, when he is ready earlier than it assumed, or when none of its buses can still be caught; during a trip in progress it does not search again. His walks are read once per refresh; every place that saves a walk already refreshes Tu viaje, and saving a place in Transit now does too. A restored backup bumps its own counter, which Tu viaje watches. The planner finds a bus's live report once per ride instead of once per stop, and the live function builds its undated alert query once per request.
Rejected: Refreshing Tu viaje on every data reload, as the audit suggested, since that happens on each water tap and logged set and would add four reads, a search and a reminder resync to each; memoizing the map props of D.3, since the maps' 15-second clocks change what they draw (the followed bus, the freshness of the others), so it would only spare the four redraws a minute of a plan map with no bus.

## 2026-10-18 — Transit offers no transfer that rides past his stop to come back, and greys out only buses it listed
Context: Leaving now from home to the gym, he saw greyed options to ride the 91 past his stop to Wonderland and take a 91 back, with the next 91 pushed down the list. Over 1,044 simulated searches a third of the transfers the search kept (131k of 376k) arrived no earlier than getting off the first bus at a stop it already passes and walking. None was listed from the timetable, but each stop's list counted every bus the search found as listed, so whenever live data broke one it came back greyed as a lost connection (2,665 of 2,934 greyed rows in a simulation with delays). They also filled slots of the search's 120 pairs of buses, so some stops listed two buses and then nothing for an hour.
Decision: The search drops a transfer when its first bus lets him get off and walk there leaving no earlier and arriving no later, the reasoning that already dropped a first bus to one he can walk to. Leaving now, a stop greys out only buses it lists from the timetable alone. The cost weights and the stop ranking are unchanged. Simulated: greyed rows 2,934 → 294, none for an option never listed; the timetable lists gain 1,236 rows of real buses that used to fall outside the pool; the stop lists cost about 5% less.
Rejected: Also dropping transfers that ride a stop or two to catch a bus that passed near the origin, left for later at his request; a test on the direction of travel, which comparing arrival times makes unnecessary.


## 2026-10-18 — Leaving now, the three stops do not repeat the same bus unless he asks
Context: Leaving now to the gym, the three stops offered were all along one street with the same bus, so a nearer stop with another bus and a transfer came sixth and never showed.
Decision: Leaving now, a stop whose best bus has the same lines as the best of a stop above it (transfer included, by route number) is left out, so the three stops show different buses. A switch above the stops, «Mostrar paraderos con el mismo bus», off by default, brings back the list as it was; it is the `transit_same_bus_stops` setting, so it survives closing the app. The search widens to 1.5 and 3 km only when fewer than three stops take him there at all, counted before this filter, so hiding repeats never sends it farther. The live data and closure checks follow the stops as listed. When fewer than three different buses are left, fewer stops show.
Rejected: Comparing every line a stop offers, which kept two stops whose rows both read «16 → 20»; telling directions apart, since he reads only the number; filling the list back to three with repeats, which is what he asked to stop.

## 2026-10-21 — Transit after two days on the street: live data back in 15 s, a stop within 30 m is reached, walking and transfers weigh in every list, other buses for the last ride
Context: Commuting by transfer, live data stayed down for minutes after the network came back (each failure doubled the wait, up to five minutes) under a misleading "lectura local vencida"; at his stop, the phone placed him across the street, so the bus due in two minutes read "probablemente no llegues" and «Salgo ahora» was off; at a transfer the trip held him to its planned bus while another line six minutes earlier got him there as soon, then asked whether he was on the planned one; and the list put first a transfer with about 15 minutes on foot, hiding one on the same first bus with 2 that arrived 5 minutes later. He also asked for every bus of the trip stacked on its timeline with five stops in view, and the warning to get off two stops ahead.
Decision: A connection that gets no answer (no network, timeout, a server error) is tried again every 15 s; an answer that says something is wrong still backs off, and an old saved reading is simply not used instead of being reported as invalid. From his GPS, a stop within 30 m is one he is at: no walk and no boarding margin; «Salgo ahora» is off only for a bus that already left. Every list compares options with each minute on foot counted twice (the weight the stop ranking already used), and orders them with 7 minutes per transfer on top, the stop ranking's transfer weight, so a transfer does not go above a direct bus for a minute less of walking. Over 216 public searches the first option changed in 50, arriving 2.1 min later and walking 2.6 min less on average, never with more transfers; a search costs about 5.2 ms instead of 4.9 on desktop Node. Waiting for his last bus, or walking to it, the trip looks each minute and with each live reading for other buses within 200 m that get him to the end no later, up to three: each is notified once ("También te sirve el …"), the card offers «Tomar el …», their buses join the live query, and moving along one's street at bus speed, beside its GPS or once it is due while his own is still minutes away, switches the trip to it. The warning to get off goes out two stops ahead (at boarding when the ride has fewer stops), held alarms likewise. During a trip, «Ver paradas del viaje» shows each bus still ahead, the first on top, five and a half stops high; elsewhere the timeline keeps eight and a half.
Rejected: Pausing his music with the warning, set aside by him for now; offering other buses for the first ride of a transfer, which would have to replace both buses; counting walking twice when deciding whether a bus beats walking the whole way, a separate rule he did not question; a stop closer than 30 m counting as reached from a saved place, where leaving the door still takes time.

## 2026-10-22 — A local product record, and colour blindness limited to the score squares
Context: Setting up the design skill's product record, which describes when and where he uses each module. Earlier specs and docs treated his colour blindness as a general colour rule.
Decision: `PRODUCT.md` holds that record and stays local and gitignored, like `SPEC.md`. His colour blindness constrains only the score squares, whose palettes are ordered by lightness (spec 4.5); no other colour choice, encoding or review takes it into account.
Rejected: Publishing `PRODUCT.md`, since it describes his routine and places; keeping the colour-blind rule as a general design constraint, which he said it never was.

## 2026-10-23 — Each tab opens on what he does there most often
Context: A full-app review with a month of his data found the repeated task last on every screen: the day's log under the trip, the grid and the tiles on Hoy; the set card sixth in an open session; two empty cards above Anotar in Comida; the training charts after five others in Gráficas.
Decision: Hoy goes score, Registro del día, then the trip, grid and tiles. Outside Transit the trip card opens compact (leave time, Salgo ahora, Avisarme) with the rest behind «Detalles del viaje», as Entreno already did. An open session goes volume, the set card, the exercise list, Terminar, then routine, timing and the trip. Comida goes Anotar, Lo que llevas, Lo anotado, and the last two only appear once something is logged. Gráficas starts with series por músculo, progreso por ejercicio and tiempo en el gym.
Rejected: Moving any feature behind a new screen or removing one; only the order and the trip card's default changed.

## 2026-10-23 — The menu opens a screen on top of the day, not on top of the last screen
Context: Every screen opened from the side menu was pushed on the one before, so after visiting nine of them «Listo» walked back through all nine. The menu's groups stayed open once opened and the list ended up scrolling.
Decision: A menu destination that is not a tab leaves the tabs plus that screen and nothing else, so «Listo» always returns to the day; if the screen was already open it comes back as it was. Screens opened from inside another (a day from Registros, an exercise from Ejercicios) still stack, because that is real hierarchy. The menu keeps one group open at a time, and opening the menu unfolds the group of the screen he is on.
Rejected: Flattening every group into one list, which needs about 17 rows and scrolls on his phone; replacing «Listo» with a home button.

## 2026-10-23 — Food tiles in one style, protein off the danger red, amber only where he taps
Context: The review found white text on the pastel calorie and protein tiles (about 1.6:1), protein in the danger coral even when its floor was met, four tile treatments in one card, amber badges in Lecturas that are not tappable, and the finished workout in the warning yellow with «Seguir entrenando» nearly invisible.
Decision: Every nutrient tile has the same shape. Calories (periwinkle) and protein (a new aqua, `protein` in the theme) keep the colour chosen on 2026-10-10, now with dark ink; the rest sit on the translucent surface, and a value past its limit shows its note in butter instead of a brown fill. This replaces "protein on red" from the 2026-10-10 entry. The Lecturas weight badges are neutral. The finished workout uses the plain card.
Rejected: Dropping colour from the two goals, which the 2026-10-10 decision asked for; green for protein, which is the success colour of the day's pills.

## 2026-10-23 — One protein goal everywhere, sleep's 8 h called "ideal", suspicious deals flagged
Context: The review found the protein goal as 131 (day detail), 131 to 160 (Hoy) and 146 (assistant); "faltan 48" on Hoy and "48 sin anotar" in the day detail for the same number; the day detail's "de 8 h 00" read as a second sleep goal next to the 7 h in Ajustes; two "series por músculo" counts side by side; a parse error («13.21 kg» at $5.99, 97% under his price) topping «Mejor valor»; and a browser exception in English on Transit.
Decision: Protein reads "131 g o más" on Hoy and in the assistant, the floor that spec 3.3 already prescribes and that the score uses. Hoy says "48 sin anotar". The day detail shows sleep as "7 h 00 · ideal 8 h 00", spec 3.5's own word for the point of full marks; the 7 h goal in Ajustes is unchanged. The weekly card is "Series por músculo de la semana". A deal 70% or more under his price shows "¿97% bajo lo tuyo? Revisa el tamaño" in butter, dims its protein per dollar and sorts last. Transit's failed update says only that it failed and kept the saved schedule; the reason goes to the log and stays stored.
Rejected: Scoring sleep against the Ajustes goal, which spec 3.5 rules out; hiding suspicious deals, since some may be real.

## 2026-10-23 — Deal review answers stay where they were tapped, and recipes take foods outside the pantry
Context: Round 2 of the full-app review. Answering «¿Es Pechuga de pollo?» changed the deal's value, the list re-sorted, the row jumped away and a second tap a moment later answered the next deal. A new recipe could only search the pantry, so with three items in it «arroz» found nothing and the recipe could not be written.
Decision: While the review pencil is on, the deals keep the order they had when it was turned on. Sí and No stay in place as a pair: the answer shows as the selected one and tapping it again clears it; tapping the other changes it. The recipe search also lists his catalogue foods that are not in the pantry, under «Fuera de la despensa»; picking one adds it to the recipe, and saving the recipe adds it to the pantry at zero in its food's unit, so the recipe names it as missing (spec 21.3).
Rejected: A list of rejected matches to fix them later, unnecessary once the answer stays on its row; adding the food to the pantry the moment it is picked, which left a stray item when the recipe was cancelled; free text ingredients with no food, which spec 21.2 keeps out of the pantry.

## 2026-10-23 — Finishing a workout shows a recap, the set button stays put, the rest is large upright
Context: The end of a session was a line of text, with «+ Serie» still active and the rest still counting above it. Each logged set added a row above «+ Serie», moving it down about 47 pt per set. The rest was the smallest text on the card unless the phone was turned sideways.
Decision: On «Terminar entreno» the top card (volume and clock) becomes the recap: finished time, volume, sets, duration and records, each record named with its estimated 1RM against the previous best, with «Seguir entrenando» under it; the screen scrolls up to it. A record is an exercise whose best set today, by spec 6.2's estimated 1RM, beats every earlier session of that exercise; a first time is not one, and during readaptation no records are shown (spec 6.5). Once finished, the logging grid, its notes and the rest disappear; the set card stays for reading. The sets logged today now sit under «+ Serie». The rest is a 44 px number, «DESCANSO SUGERIDO 3:00» before the first set and «DESCANSANDO 1:28 de 3:00 sugeridos» after, both the same height.
Rejected: A modal recap, which the app avoids for anything but forms; disabling «+ Serie» but leaving the steppers live; comparing records against the 8-week window of the marks, which would call a return to an old weight a record.

## 2026-10-23 — Fewer explanations on screen, and the missing accents restored
Context: Paragraphs of method sat in Tiempos, the timing analysis, the walk review, Transit's planner and stops, Tandas, Experimentos, Avisos de Transit and Recomendaciones, against his "less on screen" rule; the set card said the exercise's name twice; a drop-off line ended in "Spec 9:". Seeded names, technique notes, study summaries and some foods had no accents («Extension de triceps», «munecas», «sintesis»), as did several messages.
Decision: Those paragraphs are gone. The remaining-time estimate keeps «· pocos datos» while the learned pace is thin, and the trip card no longer repeats it. Recomendaciones drops its intro and the readaptation card unless readaptation is on, and folds the applied changes into «Ya aplicados». The set card shows the name once. Migration 070 adds the accents to the seeded rows only where the text is still exactly as seeded, so anything he edited stays his; messages in code are corrected too.
Rejected: Moving the explanations behind an info button, which keeps text he did not ask for; rewriting seeded text with word replacements in SQL, which would also touch his own edits.

## 2026-10-23 — The weekly summary does not judge a week in progress, and Ejercicios speaks in his units
Context: On a Thursday every muscle read «bajo la banda». Ajustes called the top score step «Tono más oscuro», which on the dark theme is the brightest. The exercise editor asked for «Descanso (seg) 120» and «Salto de peso (kg)», while every other screen writes rests as 2:00 and he trains in pounds.
Decision: In the current week a muscle under the band shows «faltan N» on a neutral tag; finished weeks keep «bajo la banda». The scale field is «Muy alto desde», the name the preview uses. Rest is entered as minutes and seconds. The weight step field is removed from the exercise editor and the new-exercise form: since 2026-10-03 the arrows step a fixed 5 lb (2.5 kg) and the stored step changes nothing; the column keeps its value.
Rejected: Showing the step in pounds, which would still be a setting that does nothing; a single minutes field with decimals, where 1.5 reads less clearly than 1:30.

## 2026-10-23 — The database reset is the open everyone waits on, and a failure shows on Ajustes
Context: Round 3 of the full-app review. «Borrar y empezar de cero» failed every time on the emulator with «Unable to delete database ... that is currently open», and Ajustes went blank. The reset cleared the shared open, so any screen asking for the database in between opened it again; expo-sqlite (iOS and Android alike) hands that caller the cached connection with one more reference, the close only dropped one, and the delete refused. Ajustes and Alimentos rendered nothing while the database was not ready, so the failure card with Reintentar, Exportar and Borrar never appeared.
Decision: The reset closes, deletes and reopens inside one promise that becomes the shared open, so every caller during it waits for the rebuilt file; a failed reset is forgotten so the next open tries again. Ajustes and Alimentos render their titled screen while not ready, like every other screen, so the failure card shows.
Rejected: Retrying the close until the delete succeeds, which cannot know how many references are out; a lock that refuses opens during the reset, which would fail the screens instead of letting them wait.

## 2026-10-23 — Nothing is filled in that he did not choose
Context: A food he had never logged in grams opened at 1 g with «Agregar» live; a recipe ingredient by weight started at 1 g and the recipe could be saved like that; a new exercise came with Mancuernas and Pecho already selected.
Decision: A first portion is empty for foods in grams or millilitres and «Agregar» stays off until he picks a chip or types; foods counted in units still start at 1, and a food he has logged keeps last time's amount. A weighed recipe ingredient starts empty and «Guardar» stays off until every weighed ingredient has an amount; counted ones start at 1. A new exercise has no equipment or main muscle selected and cannot be saved until both are chosen; a new variant still starts from its parent's.
Rejected: Starting at the label's 100 g, still an amount he did not choose; a warning after saving instead of the disabled button.

## 2026-10-23 — Goals name their number, and each kind of figure has one format
Context: Comida said «faltan 2035 para la banda» and «faltan 86 para el piso»; body weight had no unit on Hoy while Ajustes says Libras; deals and experiments printed dates as 2026-10-28; the workout recap said «0 h 03» where the planner says «54m»; the weekly summary wrote sleep «6 h 24 min» where the day says «7 h 30»; volumes read «12340 lb» in one place and «1 080 lb» in another.
Decision: The food notes say the number: «faltan 86 para 131 g», «cumplido: 131 g o más», «faltan 2035 para 2275», «entre 2275 y 2975», «bajo el mínimo de 58 g». Hoy's weight reads «kg · de hoy», since body weight is always in kilos (spec 20.2). Dates use the existing «mié 28-oct» and «jue, 23-oct-2026» forms. Gym durations use the planner's «01h12m», sleep uses the day's «7 h 30», and every training volume groups thousands with a space. «Banda» stays in training, where it is his word for 10 to 20 sets.
Rejected: A single duration format for gym and sleep, which would change two formats already in daily use; dropping the goal notes, which are what he reads on the tiles.

## 2026-10-23 — Doubtful deals go last on Hoy too, and round-three design slips
Context: The Hoy deals alert opened with the parse error «13.21 kg · $0.45 el kilo», flagged only on Ofertas, under amber uppercase tags that cannot be tapped. The chosen food in Comida was cream text on amber. Recetas and Despensa painted the field amber while typing. Ejercicios and Alimentos, side by side in the menu, used different buttons, search fields and rows. The chart bubble was 116 px wide, so its date and value wrapped and the axis date was drawn over «Detalles». The deals alert and the new-food sheet sat to the left on wide screens.
Decision: The alert uses the same comparison as Ofertas (`dealVersusUsual`), sends doubtful deals to the end with «¿97% bajo lo tuyo? Revisa el tamaño», and shows the matching word on a neutral tag. The chosen food is written in Amber Ink. Every focused field lightens to the high surface. Ejercicios has the amber «Ejercicio nuevo», the search capsule and whole-row presses with a chevron, like Alimentos, and «Guardar nuevo ejercicio» is the primary button. The bubble is 156 px and drawn after the axis. Both sheets are full width with a 400 px cap, centred like PopupSheet.
Rejected: Hiding doubtful deals from the alert, since some may be real; keeping the amber tags for his watch words.

## 2026-10-23 — A session opens on the set card, and the set button does not move on the first set
Context: Round 4 of the full-app review. «Empezar entreno» kept the planner's scroll, so the session opened on the exercise list with the set card cut off above. On an exercise with no history, the first set made «1RM estimado · mejor 127 · peor 127 lb · 8 semanas» appear and «+ Serie» dropped about 25 pt. Finishing scrolled the recap's title under the top bar, because the scroll offset was read after the content below had shrunk. «Empezar entreno» was off with no gym chosen and said nothing.
Decision: Starting and finishing scroll the screen to the top, where the set card and the recap are (`useScrollToTop` in Screen). The estimated 1RM line shows only when there is an earlier session. With no gym the start button reads «Elige dónde entrenas». «1 ejercicio» in the singular.
Rejected: Reserving the 1RM line's height on a first time, which keeps a blank line under the rest; measuring the recap again a frame later, which still depends on an offset the shrink does not report.

## 2026-10-23 — Each list leads with its answer: the portion, the walk, the best deal
Context: With 200 g of chicken chosen, Comida showed what 100 g brings, and the info bubble read «120 (240)». Transit said «Ahora no sale ningún bus...» in bold for an 8-minute walk and put the walk in small print at the end. Ofertas groups only said «18 OFERTAS», so finding where something is cheap meant opening each one.
Decision: The chosen food's line shows the typed portion («200 g · 240 kcal · 44.8 g P»), and the per-100 g line comes back when no amount is typed. The bubble puts his portion first and the label in parentheses, and drops the parentheses when they would repeat the number. With no bus and a walk available, Transit leads with «Caminando: 8 min (...)» and the no-bus line becomes a note. A closed deal group shows its first non-doubtful deal: by product «$8.70 el kilo · Food Basics · 18 ofertas», by store «Pechuga de pollo · $8.70 el kilo · 38 ofertas».
Rejected: A separate preview line under the amount, which moves «Agregar» down when it appears; ranking the walk among the buses, a planner change outside this pass; the cheapest per kilo as the group's line, which can differ from the first row the group opens to.

## 2026-10-23 — Fewer explanations in the catalogue, no rows that never fill, and the chat opens on its last message
Context: The exercise detail carried seven method sentences, «Archivar» sat between the variants and the routines, the open variant was a disabled-looking button, the rep range two bare boxes, «Quitar de ...» on top of its routine, and «Guardado» under every field he had not touched. Ejercicios and Alimentos opened with an explanatory paragraph. The weekly summary always showed weight and a Recuperación card as «— · antes —», since resting pulse and HRV do not come through the shortcut. The new-exercise form said «Unilateral» where the detail says «A un brazo». The chat opened in the middle of the conversation every time.
Decision: The method sentences and both intros go; «Archivar» moves to the end with «Conserva sus series, notas e historial.»; variants are chips with the open one selected; the rep range reads «12 a 15»; «Quitar de ...» goes last in its routine; «Guardado» appears only after he changes the field, its line kept so nothing moves. A weekly row with no data in either week is hidden, and the Recuperación card with it. The new-exercise switch is «A un brazo». The chat scrolls to its end without animation, which landed on the last message where the animated scroll stopped short.
Rejected: Moving the explanations behind an info button, text he did not ask for; hiding Recuperación for good, which spec 1.5 keeps for when the data arrives.

## 2026-10-24 — The chat scrolls to its end a frame later, and deals without a price go last
Context: Round 5 of the full-app review. The chat still opened on the oldest of its last fifty messages, every time on the emulator: the scroll to the end was asked for in the same event that reported the new content size, before the native list had that height, so it stayed at the top. In Ofertas a deal with no price sorted anywhere among deals with nothing else to compare, so Yogur griego, Salmón and Proteína en polvo opened on "— por medida" and their closed rows named no price.
Decision: The chat scrolls to its end one frame after its content changes size. Deals keep their order, and when two have no protein value to compare, one with a price per kilo goes before one with only a price, and that before one with neither, so every closed group names a price when one of its deals has it.
Rejected: An inverted list for the chat, a rewrite of the screen for one scroll; hiding deals without a price, which can still be real.

## 2026-10-24 — The set card says only what is true, and a day writes its numbers one way
Context: The set card carried "Cambiar variante reemplaza sus series pendientes." over the variant chips on every set; after finishing it said "Elige una variante para ver sus series." with one already chosen, and "Llevas 0 de 3 series planeadas". The day detail wrote water "— de 2.80 L" over "0.00 L de 2.8 L", weight "(del último día)" where Hoy says "del lun, 12-oct-2026", and "Nada por ahora. Abajo eliges y anotas." with nothing below until the pencil is tapped. The weekly summary said "0 tragos en 0 días".
Decision: No permanent variant warning: switching moves the pending sets and tapping the earlier variant moves them back, and "Cambiando variante…" still shows while it happens. Finished, the line reads "Hiciste 1 de 3 series planeadas". Water is written with two decimals for amount and goal alike on Hoy and in the day (the day report's format). The day's weight names the date it comes from. The day's food card says "Nada anotado." until the pencil opens the picker. Alcohol in the weekly summary reads "ninguno", or "1 trago en 1 día".
Rejected: Showing the warning only while the exercise has pending sets, which is nearly always during a session; one decimal for water, which hides the 150 ml sips.

## 2026-10-24 — Ajustes leftovers, and a picker list as wide as its field
Context: Open since rounds 3 and 4: confirming an import put "Cancelar" alone on a second row under "Exportar | Sí, reemplazar lo que hay"; the result read "Restaurado: 1235 filas en 41 tablas."; "Restaurar límites 25 / 50 / 100" stayed live when the limits already were those; the Catálogo card said "Comidas" where the menu and the screen say "Alimentos". Place pickers opened a 280 pt list centred on a wider field, so it was narrower and offset.
Decision: Confirming an import shows only "Sí, reemplazar lo que hay" and "Cancelar", stacked like the database reset. The result says "Respaldo importado.", keeping the note about tables left out. The restore is off while the limits are 25, 50 and 100. The button says "Alimentos". A floating bubble is never narrower than what opened it, so a picker's list matches its field; the (i) bubbles, opened from a small dot, do not change.
Rejected: A width option on each caller, when the rule holds for all of them; a row count in the message, a number he does not use.

## 2026-10-24 — The plan mid-session uses the planner's rows
Context: Round 6 of the full-app review. «Editar lo que falta» gave every exercise three rows of buttons («− Serie» «+ Serie», «Cambiar» «Omitir pendientes», «↑ Subir» «↓ Bajar») under its name and «0 hechas · 3 pendientes»; seven exercises ran about three screens, with «Guardar plan» at the end, at the moment of the session he has least attention. The planner does the same job with one row per exercise: grip, name, − and +.
Decision: The drag list moves out of the planner into `OrderList`, and both use it. Mid-session each row reads «1 de 3 series» and carries a swap button before − and +; − stops at what is done, and the swap is only there while something is pending. The swap opens «Cambiar Remo por…» under the list, with «Omitir pendientes» and «Cerrar» first and the search under them; the row being changed turns amber. Reordering is the planner's drag. «Guardar plan» and a ghost «Cancelar» share a row, and the line «Los cambios son solo para este entreno…» is gone; the routine-change notice stays.
Rejected: Keeping «↑ Subir» and «↓ Bajar» as small icons, a second way to reorder beside the drag he already uses; tapping the exercise name to open the swap, which nothing on the row would announce.

## 2026-10-24 — A tapped button stays under the finger, and sideways is only the rest
Context: «Comer una porción» moved about 61 pt down after every portion, because each one adds a row to «Lo anotado» above it; the third tap on the same spot landed on the batch's name. Turned sideways, the rest view kept the top bar and the tab island, about 40% of the height, and a pull-up set read «0 lb × 12» sideways and «0 lb (+ his body weight) × 12» upright. While fixing the first, the screen's scroll offset read in JS turned out stale on Android: a listener on the natively driven value never fired.
Decision: Screen offers `useKeepInPlace`: a block measured before a write is put back where it was each time the content changes size in the next two seconds, a frame after the change; a drag by him releases it, and a block that is gone is let go. The batch's button uses it. The offset now comes from the scroll event's own listener. Sideways, the app draws no top bar and no tab island, the clock is 40% of the screen's height (at most 200 pt), and the last set uses the set card's line.
Rejected: Moving «Tandas» above «Lo que llevas», which reorders Comida around one button; reserving room above the button, which leaves blank space before the first portion; a fixed bigger clock, which would not fit a smaller phone.

## 2026-10-24 — Recipes say what is missing, and fewer walls of options
Context: A recipe short of two ingredients said «faltan 2» and then «Arroz, Huevo grande» after the protein with no word; the ingredient rows looked the same whether he had them or not, and «Cocinar» was off with no reason. A ready recipe was a full amber card with light text, and its «se puede» tag light text on sage; one missing read «faltan 1». A new batch «Del catálogo» showed 17 chips with no search; a new exercise showed the 15 muscles twice. Fondos after an import said «No encuentro la foto en este teléfono» on all 18 rows, because rows using the general background repeated its missing photo. Experimentos read «semana 0 · 1 lecturas». The Despensa quantity field still turned amber while typing, missed by the 2026-10-23 field decision.
Decision: The recipe line under the name says «Falta Arroz, Huevo grande» (and «Queda poco: …») in Butter, the rows add «· falta» or «· poco» after the amount, the tag says «falta 1» in the singular, and every recipe is the plain card, with the sage tag in dark ink for a ready one. The batch catalogue is a search field like the recipe form's, with up to six matches and the chosen food kept. Secondary muscles wait behind «+ Músculos secundarios» unless the variant brings some. In Fondos only a row with its own photo says it is missing. Experiments count the week in progress from 1 («semana 1»), say «duró N semanas» once finished, and «1 lectura». The Despensa field lightens to the high surface like every other.
Rejected: A sentence under the disabled «Cocinar», which repeats the marked rows above it; showing the recently batched foods before he types, which needs a query for a list he uses rarely; one notice at the top of Fondos, when only the general's row is wrong.

## 2026-10-24 — Every setting in Ajustes saves on its own
Context: Round 7 of the full-app review. Ajustes saved four ways: most fields on their own, and three cards with their own button («Guardar configuración» for the assistant, «Guardar preparación» beside a bare «5» for Transit, «Guardar colores y límites» for the scale). Tapping «Groq · nube gratuita» or a palette painted it chosen, and leaving without the button lost it with no word; the scale said «Guardado» right above its disabled button. The assistant card also had its own label and field style and three paragraphs.
Decision: The three buttons are gone. A provider chip saves when tapped (Groq without a key says «Agrega la clave de Groq para usar la nube.» and stays picked until a key arrives); a key saves when its field is let go; the preparation minutes save when the field is let go, as a field like the others with «min» beside it, and 0 or more than 60 says «Sin guardar: escribe de 1 a 60 minutos.»; a palette saves when tapped and a limit when its field settles, with «Sin guardar:» and the reason while they are out of order; «Restaurar límites» saves at once. A value that arrives another way, such as an imported backup, replaces what the scale card shows. The assistant card uses the uppercase labels and glass fields of the rest of the page, with one note about where the keys live.
Rejected: A single «Guardar» at the end of the page, a fifth way to save that would hold the toggles hostage; keeping the assistant's button for the keys, which are pasted once and committed like any other field.

## 2026-10-24 — Transit stop rows lead with the times, and a swap mid-session opens where he looks
Context: In «Cómo llegar» each of the three stop rows read stop name, walk, and only then «Con transbordo: 91 → 90 a las 16:03 · sal en 2 min · llegas 16:33» in small print, while the bus list one tap deeper leads with «16:06 → 16:43». A line under the map explained that 1, 2 and 3 are the stops below. Mid-session, the swap opened «Cambiar Remo por…» under the whole list, a screen below the row he tapped, with the first eight exercises in alphabetical order (curls for a row).
Decision: A stop row reads «16:18 → 16:55 sal en 2 min» in the bus rows' large figures, then «Directo: 10 a las 16:28», the stop and the walk; the line under the map is gone. Opening the swap or «Añadir ejercicio» scrolls its panel to the top of the screen. A swap offers the exercise's own family first, then the same main muscle, then the rest; adding keeps alphabetical order.
Rejected: Opening the swap inside the row, which moves the rows under the finger; filtering the swap to one muscle, which hides a deliberate change of plan.

## 2026-10-24 — Exercise progress is a line on the scale of its own data
Context: «Progreso por ejercicio» drew bars from zero, so ten percent more volume was a few pixels and an unchanged top weight was a solid wall, with «máx 4 995 lb» as the only number. The range circles and the eye were his choice on 2026-10-10 and stay.
Decision: The chart is the weight chart's line with dots, in sage, between its lowest and highest value of the whole history, written under it («2 310 lb a 4 995 lb»). The eye still closes the empty days: with it closed the sessions sit side by side. Touching a point shows the date, the value and «3 series · 37 reps», as the bars did.
Rejected: Bars that start above zero, which exaggerate every change; a scale per visible window, which resizes the line while sliding (rejected for the bars on 2026-10-10 for the same reason).

## 2026-10-24 — Small things that said what was not so
Context: Hoy said «0 tragos» before anything was logged and «1 tragos» after one; the day said «0 tragos» under «Alcohol ninguno». The first tap on Hoy's log inserted «la noche del 23 al 24» under Sueño and moved everything below, so a second tap on «+1» missed. A day without clock times put «sin hora de entrada o de salida» in the headline size, and a past session without an end said «Sin plan de series no se puede estimar lo que falta». A new recipe started at 4 portions he never chose. The birth-date placeholder «1999-04-27» read as a date. «Ejercicio nuevo» stayed an amber button over its own open form. Registros scores sat in black boxes. A deals grouping chip lit up only when the list had been rebuilt, about a second on the emulator.
Decision: Drinks read «sin anotar», «ninguno», «1 trago», «2 tragos» everywhere, from one helper. The sleep night line shows before the first tap. The missing clock times are a quiet note, and the day detail never shows the live estimate. A new recipe's portions start empty and «Guardar» waits for them. Date placeholders say «aaaa-mm-dd». The new-exercise button hides while its form is open. A Registros score fills its box with its square's colour from the grid, dark ink on the light steps and light text on the dark ones (4.5 to 1 or more in all five palettes). The deals chip lights at once and the list follows (measured in Chrome: from about 160 ms to under 20 ms for the chip).
Rejected: A small coloured square beside the date in Registros, too small to scan on the dark steps; drawing «0 tragos» faint instead of «sin anotar», which still states a number he did not log.

## 2026-10-24 — A food that is not there is created from the search, and an added food says so
Context: Round 8 of the full-app review. Searching «kefir» in Comida said «Nada con ese nombre. Con el lápiz lo agregas o le pones palabras clave.»; the pencil opened Alimentos with the search gone, the name had to be typed again, and back in Comida the new food still had to be found and chosen. Tapping «Agregar» folded the chosen row back into the list he started from, which is also what letting go of a food looks like, and the totals changed below the fold. With nothing logged, «Ver los otros 14» was the only thing under the search.
Decision: While searching, the list ends with «Alimento nuevo: Kefir» (what he typed, capitalised), unless a food already has exactly that name. It opens the food sheet over Comida with the name filled; once saved, the food comes back chosen for its amount (empty in grams or millilitres, 1 when counted, as decided on 2026-10-23). After «Agregar», a line under the meal slots says «Anotado: 200 g · Pechuga de pollo, cena» with «Deshacer», which removes that entry; the line goes when he picks the next food, when the meal slot changes, or when that entry is removed, and the search empties after each add. With no usual or recent foods, the catalogue is listed without the button.
Rejected: A toast that disappears on its own, which moves the list a second time; carrying the name into Alimentos, still a second screen and a way back; a separate create button beside the pencil, one more control on the card for something done now and then.

## 2026-10-24 — The rest clock turns sage when the suggested rest is reached
Context: «DESCANSANDO 3:19 de 2:00 sugeridos» looked the same as 0:30; from the bench he had to read two numbers and compare them, and sideways the amber block never changed.
Decision: Upright, the clock turns sage at the suggested time, as the clock rounds it; sideways, the amber block turns sage with the same dark ink. Spec 9 still holds: the timer is a suggestion and starting early says nothing.
Rejected: A vibration or a sound, a nudge the app avoids; a «listo» label, words for what the colour already says; a warning colour while short of it, which spec 9 rules out.

## 2026-10-24 — The grey note goes, units stay lowercase, planned swaps go after their group
Context: A day with nothing logged added a butter card «Gris porque ese día no quedó nada anotado...» under an amber card, today included, where nothing is grey and the day is not over; «100 sin anotar» already said it. Uppercase labels wrote units as «200 G (POR 100 G)», «PROTEÍNA G», «SODIO MG», and the bubble wrote «0 (0) g». The swap for Remo listed, after Dominadas, four curls and raises already in today's plan. A variant chip read «Curl martillo · mancuernas · Mancuernas».
Decision: The day detail drops that card (the grid bubble keeps its one line, and the missing-profile card stays). The bubble's head is not uppercase and the food form keeps units lowercase («PROTEÍNA g»); a figure equal to its label figure has no parentheses. A swap still offers the family first and the same muscle next, and inside each group what is already in today's plan goes after the rest. A variant chip adds the equipment only when its name does not say it.
Rejected: Hiding planned exercises from the swap, since moving sets onto one already planned is a real choice; dropping uppercase from the form's labels, which the design system keeps.

## 2026-10-24 — Lecturas says each weight once, the raise ranking is a list, Fondos comes back to its list
Context: Lecturas stamped «Sueño · 20 de 100 puntos» under each of the four Sueño studies, and the same in every scored topic. Recomendaciones packed a four-option ranking into one paragraph («1) Máquina... 2) Polea... 3)... 4)...»). Choosing a background from Fondos left him on the screen tried, so the next one was menu, Ajustes, Fondos again (open since round 3).
Decision: When every study of a topic supports the same criterion, its tag shows once under the title, with only the points when the title already names it («20 de 100 puntos»; «Entrenar · 22 de 100 puntos» under Volumen de entrenamiento). The ranking has one option per line. Saving, «Usar el general» and «Cancelar» in the background editor go back to Fondos, which «Listo» closes to the day.
Rejected: The tag in the card's header row, too narrow beside «Disponibilidad de energía»; going back only after saving, when cancelling ends the same task.
