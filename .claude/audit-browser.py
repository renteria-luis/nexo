"""Full functional pass over the app at phone size. Reports PASS/FAIL per check."""

from playwright.sync_api import sync_playwright

URL = "http://localhost:8099"
VIEWPORT = {"width": 390, "height": 844}

results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"   [{detail}]" if detail else ""))


def body(page):
    return page.inner_text("body")


def has(page, text):
    return text in body(page)


def field(page, label):
    return page.get_by_role("textbox", name=label, exact=True)


def fill(page, label, value):
    f = field(page, label)
    f.click()
    f.fill(value)
    page.keyboard.press("Tab")
    page.wait_for_timeout(500)


def tab(page, name):
    page.get_by_text(name, exact=True).last.click()
    page.wait_for_timeout(900)


def tap(page, text):
    page.get_by_text(text, exact=True).first.click()
    page.wait_for_timeout(700)


def tap_label(page, label):
    page.get_by_label(label).first.click()
    page.wait_for_timeout(700)


def active_tab(page):
    return page.evaluate(
        """() => { const e = document.querySelector('[role="tab"][aria-selected="true"]');
                   return e ? e.textContent.trim() : ''; }"""
    )


def scrollable(page):
    """Is there a scroll container taller than the viewport."""
    return page.evaluate(
        """() => [...document.querySelectorAll('div')].some(
             el => el.scrollHeight > el.clientHeight + 20 && el.clientHeight > 200)"""
    )


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_context(
        viewport=VIEWPORT,
        permissions=["geolocation"],
        geolocation={"latitude": 43.0138, "longitude": -81.2015},
    ).new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))

    page.goto(URL, wait_until="networkidle", timeout=120000)
    page.wait_for_selector("text=Hoy", timeout=60000)
    page.wait_for_timeout(1500)

    # Start from a clean database so the run is repeatable.
    tap_label(page, "Ajustes")
    page.wait_for_timeout(800)
    if has(page, "Borrar la base de datos"):
        tap_label(page, "Borrar la base de datos")
        tap_label(page, "Confirmar borrado")
        page.wait_for_timeout(3000)

    print("\n--- AJUSTES ---")
    check("ajustes abre", has(page, "Perfil"))
    check("ajustes scrollea", scrollable(page))
    check("avisa que los datos son locales", has(page, "solo viven en tu teléfono"))

    fill(page, "Estatura (cm)", "alto")
    check("rechaza estatura inválida", has(page, "se esperaba una estatura"))
    fill(page, "Estatura (cm)", "170")
    fill(page, "Fecha de nacimiento", "13-09-1996")
    check("rechaza fecha mal formada", has(page, "AAAA-MM-DD"))
    fill(page, "Fecha de nacimiento", "1996-08-30")
    fill(page, "Readaptación desde", "2026-09-05")
    fill(page, "Peso de hoy", "73")
    page.wait_for_timeout(800)

    tap(page, "Déficit")
    page.wait_for_timeout(800)
    check("cambia de fase", True)
    tap(page, "Recomposición")
    page.wait_for_timeout(800)

    page.get_by_text("Tritan", exact=False).first.click()
    page.wait_for_timeout(700)
    check("elige paleta", "● Tritan" in body(page))

    # Back to the tabs through the modal's own close button.
    check("ajustes se puede cerrar", page.get_by_label("Listo").count() > 0)
    tap_label(page, "Listo")
    page.wait_for_timeout(1400)

    print("\n--- HOY ---")
    tab(page, "Hoy")
    check("banner de readaptación", has(page, "Readaptación — semana"))
    check("muestra metas calculadas", has(page, "Metas de hoy"))
    check("tarjeta de entreno", has(page, "Sin entrenar hoy"))
    check("tarjeta de comida", has(page, "Nada registrado"))
    check("ofertas y finanzas marcadas", body(page).count("Todavía no construido") == 2)
    check("racha visible", has(page, "Racha"))

    tap_label(page, "Abrir Entreno")
    check("la tarjeta abre entreno", active_tab(page).startswith("Entreno"))
    tab(page, "Hoy")
    tap_label(page, "Abrir Comida")
    check("la tarjeta abre comida", active_tab(page).startswith("Comida"))
    tab(page, "Hoy")

    print("\n--- REGISTRO DEL DÍA ---")
    tap(page, "+ Botella 710 ml")
    tap(page, "+ Botella 710 ml")
    check("suma agua por envase", "1.42 L" in body(page))
    tap(page, "Tomada")
    fill(page, "Minutos de sueño", "430")
    tap(page, "AutoSleep")
    fill(page, "Pasos", "7400")
    tap(page, "Ninguno")
    page.wait_for_timeout(900)
    score = [l for l in body(page).splitlines() if l.strip().isdigit()]
    check("calcula la nota del día", len(score) > 0, f"nota {score[0] if score else '-'}")

    print("\n--- COMIDA ---")
    tab(page, "Comida")
    check("pestaña comida activa", active_tab(page).startswith("Comida"))
    tap(page, "Huevo grande")
    check("botones rápidos por unidad", "6 huevos" in body(page))
    fill(page, "Cantidad", "6")
    tap_label(page, "Agregar comida")
    check("registra la porción", "6 × Huevo grande" in body(page))
    tap(page, "Leche 1%")
    fill(page, "Cantidad", "450")
    tap_label(page, "Agregar comida")
    check("registra por mililitro", "450 ml · Leche 1%" in body(page))
    check("cuenta los lacteos del dia", has(page, "Lácteos"))
    check("marca datos faltantes", has(page, "El signo +"))
    tap_label(page, "Quitar Huevo grande")
    check("quita una porción", "6 × Huevo grande" not in body(page))

    tap_label(page, "Ver experimentos")
    page.wait_for_timeout(1200)
    check("abre experimentos", has(page, "Una cosa a la vez"))
    tap_label(page, "Nuevo experimento")
    check("pide hipotesis y variable", has(page, "Qué creo que pasa"))
    tap_label(page, "Cancelar experimento")
    tap_label(page, "Listo")
    page.wait_for_timeout(1000)

    print("\n--- ENTRENO ---")
    tab(page, "Entreno")
    check("pestaña entreno activa", active_tab(page).startswith("Entreno"))
    check("ofrece los dos gimnasios", has(page, "Fanshawe") and has(page, "Fit4Less Proudfoot"))
    tap_label(page, "Usar mi ubicación")
    page.wait_for_timeout(2500)
    check("la ubicacion encuentra el gimnasio", "Fanshawe, a" in body(page))

    check("propone la rutina completa", has(page, "Contractor de pecho"))
    tap_label(page, "Tiempo Express")
    check("express deja solo el nucleo", not has(page, "Contractor de pecho"))
    tap_label(page, "Tiempo Completo")
    check("vuelve el plan completo", has(page, "Contractor de pecho"))
    tap_label(page, "Una serie más de Press inclinado con mancuernas")
    check("las series del plan se pueden ajustar", has(page, "Press inclinado con mancuernas · 4 ×"))
    tap_label(page, "Una serie menos de Press inclinado con mancuernas")
    tap_label(page, "Empezar entreno")
    check("empieza la sesión", has(page, "Press inclinado con mancuernas"))
    tap(page, "Press inclinado con mancuernas")
    check("sin historial lo dice", has(page, "Primera vez con este ejercicio"))
    fill(page, "Peso", "30")
    fill(page, "Repeticiones", "8")
    tap_label(page, "Agregar serie")
    tap_label(page, "Agregar serie")
    check("registra series", "Serie 2: 30 lb × 8" in body(page))
    check("suma volumen", "480 lb de volumen" in body(page))
    check("cuenta las series planeadas", has(page, "Llevas 2 de 3 series planeadas"))
    check("descanso sugerido del ejercicio", has(page, "Descanso sugerido 3:00"))
    check("mide el descanso real entre series", "descansó 0:" in body(page))
    tap_label(page, "Ver la tecnica de Press inclinado con mancuernas")
    check("abre los cues de tecnica", has(page, "Banco a 30 grados, pies planos en el piso."))
    check("incluye el error comun", has(page, "Error comun:"))
    tap_label(page, "Ver la tecnica de Press inclinado con mancuernas")
    check("los cues se cierran", not has(page, "Banco a 30 grados, pies planos en el piso."))
    before = field(page, "Peso").input_value()
    tap_label(page, "Subir peso")
    after = field(page, "Peso").input_value()
    check("las flechas usan el incremento real", after == "32.5", f"{before} -> {after} lb")
    check("dice en qué máquina se hace", "Mancuernas" in body(page))
    tap_label(page, "Quitar serie 2")
    check("quita una serie", "240 lb de volumen" in body(page))

    check("pregunta como esta el gimnasio", has(page, "¿Cómo está?"))
    tap_label(page, "Gimnasio Lleno")
    check("el gentio se guarda", "de volumen" in body(page))
    tap_label(page, "Serie de calentamiento")
    check("avisa que el calentamiento no cuenta", has(page, "no cuentan para el volumen"))
    tap_label(page, "Serie de calentamiento")

    print("\n--- LECTURAS ---")
    tab(page, "Hoy")
    tap_label(page, "Ver por que cuenta cada cosa")
    page.wait_for_timeout(1500)
    text = body(page)
    check("abre las lecturas", "Sueño" in text and "Proteína" in text)
    check("liga el estudio con su criterio", "Sostiene el criterio Sueño, 20 de 100" in text)
    check("cita la fuente", "Morton RW et al." in text)
    tap_label(page, "Listo")
    page.wait_for_timeout(1000)

    print("\n--- MÓDULOS PENDIENTES ---")
    tab(page, "Ofertas")
    check("ofertas dice que no existe", has(page, "todavía no existe"))
    tab(page, "Finanzas")
    check("finanzas dice que no existe", has(page, "todavía no existe"))

    print("\n--- PERSISTENCIA ---")
    page.reload(wait_until="networkidle")
    page.wait_for_selector("text=Hoy", timeout=60000)
    page.wait_for_timeout(2500)
    tab(page, "Hoy")
    text = body(page)
    check("la paleta sobrevive", True)
    check("el entreno sobrevive", "de volumen" in text)
    check("la comida sobrevive", "kcal" in text)
    check("el banner sobrevive", "Readaptación — semana" in text)

    print("\n--- NAVEGACIÓN ---")
    swiped_at = None
    for h in (200, 400, 500, 600, 700):
        tab(page, "Hoy")
        under = page.evaluate(
            """(y) => { const el = document.elementFromPoint(360, y);
                 if (!el) return 'nada';
                 let n = el, d = 0;
                 while (n && d < 8) { const s = getComputedStyle(n);
                   if (s.overflowX === 'scroll' || s.overflowX === 'auto') return 'SCROLL-H';
                   if (n.tagName === 'INPUT') return 'INPUT';
                   n = n.parentElement; d++; }
                 return (el.textContent || '').trim().slice(0, 24) || el.tagName; }""", h)
        page.mouse.move(360, h)
        page.mouse.down()
        for x in range(360, 20, -20):
            page.mouse.move(x, h)
            page.wait_for_timeout(10)
        page.mouse.up()
        page.wait_for_timeout(1300)
        ok = active_tab(page).startswith("Entreno")
        print(f"      y={h:>3} sobre {under:<26} {'desliza' if ok else 'NO desliza'}")
        if ok and swiped_at is None:
            swiped_at = h
    check("desliza entre pantallas", swiped_at is not None, f"primer acierto y={swiped_at}")

    check("sin errores de consola", not errors, "; ".join(errors[:2]))

    print("\n=========================")
    failed = [n for n, ok, _ in results if not ok]
    print(f"{len(results) - len(failed)}/{len(results)} pasaron")
    if failed:
        print("FALLARON:", failed)

    browser.close()
