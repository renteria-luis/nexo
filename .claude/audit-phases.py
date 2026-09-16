"""Phases 1-3 in the browser: batches, the visible target change, the weekly summary.
Fakes the clock to walk through five days, since a target change needs four weigh-ins."""

from datetime import datetime

from playwright.sync_api import sync_playwright

URL = "http://localhost:8099"
results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"   [{detail}]" if detail else ""))


def body(page):
    return page.inner_text("body")


def has(page, text):
    return text in body(page)


def fill(page, label, value):
    f = page.get_by_role("textbox", name=label, exact=True)
    f.click()
    f.fill(value)
    page.keyboard.press("Tab")
    page.wait_for_timeout(400)


def tab(page, name):
    page.get_by_text(name, exact=True).last.click()
    page.wait_for_timeout(900)


def tap(page, text):
    page.get_by_text(text, exact=True).first.click()
    page.wait_for_timeout(700)


def tap_label(page, label):
    page.get_by_label(label, exact=True).first.click()
    page.wait_for_timeout(900)


def labelled(page, label):
    return page.get_by_label(label, exact=True).count() > 0


def open_day(ctx, page, day):
    ctx.clock.set_fixed_time(datetime(2026, 9, day, 12, 0))
    page.reload(wait_until="networkidle")
    page.wait_for_selector("text=Hoy", timeout=60000)
    page.wait_for_timeout(2000)


def weigh(page, kg):
    tap_label(page, "Ajustes")
    fill(page, "Peso de hoy", kg)
    page.wait_for_timeout(600)
    tap_label(page, "Listo")
    page.wait_for_timeout(1200)


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={"width": 390, "height": 844})
    ctx.clock.set_fixed_time(datetime(2026, 9, 10, 12, 0))
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(URL, wait_until="networkidle", timeout=120000)
    page.wait_for_selector("text=Hoy", timeout=60000)
    page.wait_for_timeout(1500)

    tap_label(page, "Ajustes")
    if has(page, "Borrar la base de datos"):
        tap_label(page, "Borrar la base de datos")
        tap_label(page, "Confirmar borrado")
        page.wait_for_timeout(3000)
    fill(page, "Estatura (cm)", "170")
    fill(page, "Fecha de nacimiento", "1996-08-30")
    fill(page, "Peso de hoy", "80")
    page.wait_for_timeout(600)
    tap_label(page, "Listo")
    page.wait_for_timeout(1200)

    print("\n--- DÍA 1: TANDAS ---")
    check("sin cambio de metas el primer día", not has(page, "Objetivos actualizados"))
    tab(page, "Comida")
    tap_label(page, "Nueva tanda")
    fill(page, "Nombre", "Pechuga de pollo")
    fill(page, "Calorías", "120")
    fill(page, "Proteína (g)", "23")
    fill(page, "Grasa (g)", "2.5")
    fill(page, "Peso crudo total (g)", "1600")
    fill(page, "Porciones", "8")
    tap_label(page, "Guardar tanda")
    page.wait_for_timeout(800)
    check("crea la tanda desde la etiqueta", has(page, "Pechuga de pollo · 8 de 8 porciones"))
    check("proteína por porción", has(page, "46 g de proteína por porción"))
    check("calorías por porción", has(page, "240 kcal"))

    tap_label(page, "Comer una porción de Pechuga de pollo")
    check("un toque descuenta una porción", has(page, "7 de 8 porciones"))
    check("la porción entra al registro", labelled(page, "Quitar Pechuga de pollo"))
    tap_label(page, "Quitar Pechuga de pollo")
    check("quitarla devuelve la porción", has(page, "8 de 8 porciones"))
    tap_label(page, "Comer una porción de Pechuga de pollo")

    tap_label(page, "Nueva tanda")
    fill(page, "Nombre", "Carne molida")
    fill(page, "Calorías", "250")
    fill(page, "Proteína (g)", "17")
    fill(page, "Grasa (g)", "20")
    fill(page, "Peso crudo total (g)", "1000")
    fill(page, "Porciones", "5")
    tap(page, "Grasa escurrida")
    guardar = page.get_by_label("Guardar tanda", exact=True)
    check("escurrida pide carbohidratos", guardar.is_disabled() or guardar.get_attribute("aria-disabled") == "true")
    fill(page, "Carbohidratos (g)", "0")
    tap_label(page, "Guardar tanda")
    page.wait_for_timeout(800)
    # 200 g a portion: 34 g protein * 4 = 136 kcal fatless, 500 kcal on the label.
    check("grasa escurrida muestra rango", has(page, "entre 136 y 500 kcal, grasa escurrida"))

    tap_label(page, "Nueva tanda")
    fill(page, "Nombre", "Arroz")
    fill(page, "Calorías", "130")
    fill(page, "Proteína (g)", "2.7")
    fill(page, "Grasa (g)", "0.3")
    fill(page, "Peso crudo total (g)", "900")
    fill(page, "Porciones", "2.5")
    guardar = page.get_by_label("Guardar tanda", exact=True)
    check("porciones no enteras no se guardan", guardar.is_disabled() or guardar.get_attribute("aria-disabled") == "true")
    tap_label(page, "Cancelar tanda")

    tab(page, "Entreno")
    tap_label(page, "Empezar entreno")
    tap(page, "Press inclinado con mancuernas")
    fill(page, "Peso", "30")
    fill(page, "Repeticiones", "8")
    tap_label(page, "Agregar serie")

    print("\n--- DÍAS 2 A 4: PESO ---")
    for day in (11, 12):
        open_day(ctx, page, day)
        weigh(page, "78")
        tab(page, "Hoy")
        check(f"sin cambio con pocos pesajes (día {day - 9})", not has(page, "Objetivos actualizados"))
    open_day(ctx, page, 13)
    weigh(page, "78")
    tab(page, "Hoy")
    check("cuarto pesaje recalcula y lo dice", has(page, "Objetivos actualizados: peso promedio 78.5 kg"))

    print("\n--- DÍA 5 ---")
    open_day(ctx, page, 14)
    tab(page, "Hoy")
    check("el aviso sigue hasta verlo", has(page, "Objetivos actualizados"))
    tap_label(page, "Ver el cambio de metas")
    check("muestra antes y después", has(page, "Peso base: 80 → 78.5 kg"))
    tap_label(page, "Entendido")
    check("se descarta", not has(page, "Objetivos actualizados"))
    page.reload(wait_until="networkidle")
    page.wait_for_selector("text=Hoy", timeout=60000)
    page.wait_for_timeout(2000)
    tab(page, "Hoy")
    check("descartado sobrevive recargar", not has(page, "Objetivos actualizados"))

    tab(page, "Comida")
    check("aviso de tanda vieja", has(page, "Quedan 7 porciones de Pechuga de pollo de hace 4 días"))

    print("\n--- RESUMEN SEMANAL ---")
    tab(page, "Hoy")
    tap_label(page, "Ver el resumen de la semana")
    page.wait_for_timeout(1500)
    check("abre en la semana actual", has(page, "2026-09-14 a 2026-09-20"))
    check("semana nueva compara contra las previas", has(page, "Pecho · 0 directas"))
    siguiente = page.get_by_label("Semana siguiente", exact=True)
    check("no deja ir al futuro", siguiente.get_attribute("aria-disabled") == "true" or siguiente.is_disabled())
    tap_label(page, "Semana anterior")
    page.wait_for_timeout(1500)
    text = body(page)
    check("semana anterior", "2026-09-07 a 2026-09-13" in text)
    check("series por músculo con banda", "Pecho · 1 directas" in text and "bajo la banda" in text)
    check("peso promedio de la semana", "78.5 kg esta semana" in text)
    check("comida contada", "1 días con comida" in text)
    check("secciones completas", all(s in text for s in ("Creatina, 28 días", "Pulso en reposo", "Jr. Bacon Cheeseburgers")))
    tap_label(page, "Listo")
    page.wait_for_timeout(1000)
    check("se cierra", has(page, "Registro del día"))

    check("sin errores de consola", not errors, "; ".join(errors[:2]))
    failed = [n for n, ok, _ in results if not ok]
    print(f"\n{len(results) - len(failed)}/{len(results)} pasaron")
    if failed:
        print("FALLARON:", failed)
        page.screenshot(path="phases-fail.png", scale="css")
    browser.close()
