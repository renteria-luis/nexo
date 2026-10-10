import { memo, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

type RenderPage = (start: number, count: number) => ReactNode;

/** Un ancho de grafica de dias. Memo: deslizar no vuelve a dibujar las que ya estan. */
const Page = memo(function Page({
  start,
  count,
  step,
  height,
  render,
}: {
  start: number;
  count: number;
  step: number;
  height: number;
  render: RenderPage;
}) {
  return <View style={{ width: count * step, height }}>{render(start, count)}</View>;
});

/**
 * La franja de dias de una grafica, que se desliza con el dedo hacia los dias de antes.
 *
 * Es el desplazamiento nativo, el mismo de la cuadricula de Hoy: suave, con rebote en
 * las puntas y sin libreria de gestos. Al soltar se acomoda a un dia entero, asi que
 * ninguna barra queda cortada en un borde. Solo existe dentro del rectangulo de las
 * barras; fuera de el, deslizar hace lo de siempre (decision 2026-10-10).
 *
 * Se dibujan solo las paginas cerca de lo que se ve: un anio en la vista semanal mide
 * decenas de miles de puntos de ancho, y un dibujo asi no cabe en la memoria.
 */
export function DayScroll({
  total,
  visible,
  first,
  width,
  height,
  renderPage,
  onMove,
  onDragStart,
}: {
  /** Todos los dias de la grafica, del primer dato al ultimo. */
  total: number;
  /** Los que caben a la vez. */
  visible: number;
  /** El primero que se ve. Lo lleva la grafica, que escribe las fechas de abajo. */
  first: number;
  width: number;
  height: number;
  renderPage: RenderPage;
  onMove: (first: number) => void;
  onDragStart?: () => void;
}) {
  const step = width / visible;
  const fits = total <= visible;
  // Solo al abrir: despues manda el dedo, y moverla desde aqui la haria saltar.
  const [opening] = useState(() => ({ x: first * step, y: 0 }));

  return (
    <ScrollView
      horizontal
      style={{ width, height }}
      contentOffset={opening}
      snapToInterval={fits ? undefined : step}
      decelerationRate="fast"
      showsHorizontalScrollIndicator={false}
      scrollEventThrottle={16}
      onScrollBeginDrag={onDragStart}
      onScroll={(event) => {
        const next = Math.round(event.nativeEvent.contentOffset.x / step);
        onMove(Math.max(0, Math.min(total - visible, next)));
      }}
    >
      {Array.from({ length: Math.ceil(total / visible) }, (_, page) => {
        const start = page * visible;
        const count = Math.min(visible, total - start);
        // Un ancho de grafica de margen a cada lado: un deslizamiento rapido no alcanza
        // a ver una pagina antes de que se dibuje.
        return start + count > first - visible && start < first + 2 * visible ? (
          <Page
            key={page}
            start={start}
            count={count}
            step={step}
            height={height}
            render={renderPage}
          />
        ) : (
          <View key={page} style={{ width: count * step, height }} />
        );
      })}
      {/* Con todo a la vista igual se desliza y rebota (decision 2026-10-10). En iOS 26
          el gesto de volver solo cede ante un contenido mas ancho que su marco, asi que
          sin este pixel de mas, deslizar hacia la derecha sacaba de la pantalla. */}
      {fits && <View style={{ width: StyleSheet.hairlineWidth, height }} />}
    </ScrollView>
  );
}
