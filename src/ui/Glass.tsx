import { useId, type ReactNode } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { theme } from './theme.ts';

// Expo warns that some iOS 26 betas report Liquid Glass as available without the API
// behind it, and GlassView crashes there. Asked once: neither answer changes while the
// app runs.
const HAS_GLASS = Platform.OS === 'ios' && isLiquidGlassAvailable() && isGlassEffectAPIAvailable();

/** Lo que se oscurece el vidrio: lo bastante para leer encima, no tanto que tape. */
const TINT = 'rgba(0, 0, 0, 0.22)';

/**
 * El vidrio de iOS 26, solo para lo que flota encima del contenido: la barra de abajo,
 * el menu lateral, la bola y los botones de arriba. Donde iOS no lo dibuja (el navegador,
 * un iOS viejo) queda un relleno translucido, que se lee igual.
 *
 * Es el vidrio transparente de Apple, el que usa encima de fotos, apenas oscurecido para
 * que los iconos y las letras claras no se mezclen con lo de abajo (2026-10-18). El
 * esmerilado en oscuro, el de antes, iOS lo cierra casi hasta el negro en cuanto pasa
 * por encima de algo claro, para que la letra blanca se lea: sobre una foto se veia
 * como un boton negro.
 *
 * Encima lleva su brillo: una luz de arriba que se apaga hacia la mitad y un filo claro
 * que se enciende en los dos extremos, como el canto de un vidrio que agarra la luz.
 * Y debajo, una sombra suave que lo despega del fondo.
 *
 * El vidrio va detras del contenido como una capa, no lo envuelve: asi la sombra queda
 * fuera del recorte de las esquinas y el estilo que recibe (tamano, relleno, filas)
 * sigue mandando sobre los hijos igual que en un View.
 *
 * En su version clara: el oscurecido lo pone el tinte, que se puede medir, y no iOS,
 * que lo decide segun lo que haya detras.
 */
export function Glass({
  children,
  style,
  interactive = false,
}: {
  children?: ReactNode;
  /** Lleva el borderRadius: el vidrio y el brillo lo copian. */
  style?: StyleProp<ViewStyle>;
  /** Reacciona al dedo como los botones de iOS. Solo se lee al montar. */
  interactive?: boolean;
}) {
  const radius = StyleSheet.flatten(style)?.borderRadius;
  const corners = { borderRadius: radius, borderCurve: 'continuous' as const };
  return (
    <View style={[styles.lifted, style]}>
      {HAS_GLASS ? (
        <GlassView
          style={[StyleSheet.absoluteFill, corners]}
          glassEffectStyle="clear"
          colorScheme="light"
          tintColor={TINT}
          isInteractive={interactive}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, corners, { backgroundColor: theme.glass }]} />
      )}
      <Sheen radius={typeof radius === 'number' ? radius : 0} />
      {children}
    </View>
  );
}

/** El brillo del vidrio: la luz de arriba y el filo. Dibujado, porque es un degradado. */
function Sheen({ radius }: { radius: number }) {
  // Cada dibujo nombra sus degradados: en el navegador los nombres son de toda la pagina.
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, styles.clip, { borderRadius: radius }]}
    >
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id={`light${id}`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#ffffff" stopOpacity={0.16} />
            <Stop offset="0.45" stopColor="#ffffff" stopOpacity={0.05} />
            <Stop offset="1" stopColor="#ffffff" stopOpacity={0} />
          </LinearGradient>
          <LinearGradient id={`edge${id}`} x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor="#ffffff" stopOpacity={0.75} />
            <Stop offset="0.15" stopColor="#ffffff" stopOpacity={0.25} />
            <Stop offset="0.5" stopColor="#ffffff" stopOpacity={0.08} />
            <Stop offset="0.85" stopColor="#ffffff" stopOpacity={0.25} />
            <Stop offset="1" stopColor="#ffffff" stopOpacity={0.75} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" rx={radius} fill={`url(#light${id})`} />
        {/* Trazo de 2 sobre el borde: el recorte se come la mitad de afuera y queda un
            filo de 1 que sigue la curva de las esquinas. */}
        <Rect
          width="100%"
          height="100%"
          rx={radius}
          fill="none"
          stroke={`url(#edge${id})`}
          strokeWidth={2}
        />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  lifted: {
    boxShadow: '0 10px 24px rgba(0, 0, 0, 0.35)',
  },
  clip: {
    overflow: 'hidden',
  },
});
