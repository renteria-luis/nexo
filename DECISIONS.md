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
Context: Durmió 5 h 05 por trabajo y la app le dio 0 de 20, igual que si no hubiera
dormido nada. El umbral de §3.5 (cero por debajo de 6 h) no dice lo que dice la
evidencia, y lo mismo pasaba con la proteína y las calorías, que eran bandas con
acantilado.
Decision: Tres criterios pasan a leerse de una curva de puntos con rectas entre
ellos. La del sueño es la escala que él escribió a partir de Saner 2020, con los 20
puntos en las 8 h; 5 h 05 ahora son 7.3. La de proteína sigue la meseta de Morton
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
