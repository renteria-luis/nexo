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
