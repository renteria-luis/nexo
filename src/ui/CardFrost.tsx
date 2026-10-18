import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Animated, Image, StyleSheet, View, useWindowDimensions } from 'react-native';

import { photoFrame, type Photo } from '../core/backgrounds.ts';

import { SceneContext } from './scene.ts';

/** El desenfoque detras de las tarjetas: un 30% del maximo del deslizador de Fondos. */
const CARD_BLUR = 12;
/** Y lo que las tarjetas oscurecen lo que tienen detras, sea cual sea el fondo. */
const CARD_DIM = 0.25;
/**
 * El pedazo desenfocado se dibuja a un cuarto del tamano y se agranda: desenfocado no
 * se nota, y cada tarjeta desenfoca una foto cuatro veces mas chica, en memoria y tiempo.
 */
export const QUALITY = 4;

/**
 * El esmerilado de una tarjeta (2026-10-18, a peticion suya): detras de ella, el mismo
 * pedazo de fondo que tapa, desenfocado y un poco oscurecido, alineado con la pantalla y
 * movido por el scroll en el hilo nativo.
 *
 * Lo dibuja la app y no iOS: los desenfoques de iOS 26 fallaron uno tras otro (el de
 * expo-blur solo oscurecia, el vidrio esmerilado salia de un gris lechoso), y este,
 * ademas, desenfoca exactamente lo que se pide. Solo hace falta con una foto: un
 * degradado o unas manchas desenfocados se ven igual, y ahi basta con oscurecer.
 *
 * Se mide contra el marco de su pantalla al colocarse y cada vez que el contenido cambia
 * de alto. Al deslizar entre pestanas, el pedazo viaja con la tarjeta hasta que la pagina
 * se asienta, y entonces vuelve a coincidir.
 */
export function CardFrost({ radius }: { radius: number }) {
  const scene = useContext(SceneContext);
  const self = useRef<View>(null);
  const [spot, setSpot] = useState<{ left: number; top: number } | null>(null);
  const photo = scene?.background.kind === 'photo' ? scene.background : null;
  const epoch = scene?.epoch;

  const measure = useCallback(() => {
    const frame = scene?.frame.current;
    const card = self.current;
    if (!scene || !frame || !card) return;
    card.measureInWindow((x, y) => {
      frame.measureInWindow((frameX) => {
        // Donde estaria la tarjeta en la ventana con la pagina asentada y sin desplazar.
        setSpot({ left: frameX - x, top: -(y + (scene.offset.current ?? 0)) });
      });
    });
  }, [scene]);

  useEffect(() => {
    if (photo) measure();
  }, [photo, measure, epoch]);

  return (
    <View
      ref={self}
      collapsable={false}
      pointerEvents="none"
      onLayout={photo ? measure : undefined}
      style={[StyleSheet.absoluteFill, styles.clip, { borderRadius: radius }]}
    >
      {photo && spot && scene && (
        <PhotoCopy
          photo={photo}
          left={spot.left}
          top={spot.top}
          blur={CARD_BLUR}
          scrollY={scene.scrollY}
        />
      )}
      <View style={[StyleSheet.absoluteFill, styles.dim]} />
    </View>
  );
}

/**
 * La foto de fondo del tamano de la ventana, desenfocada `blur` puntos mas que ella y
 * con su oscurecido, puesta en `left` y `top` de quien la contiene y movida por el
 * scroll si lo hay. La usan las tarjetas y lo que va detras de las hojas.
 */
export function PhotoCopy({
  photo,
  left,
  top,
  blur,
  scrollY,
}: {
  photo: Photo;
  left: number;
  top: number;
  blur: number;
  scrollY?: Animated.Value;
}) {
  const window = useWindowDimensions();
  return (
    <Animated.View
      style={[
        styles.copy,
        {
          left,
          top,
          width: window.width / QUALITY,
          height: window.height / QUALITY,
          transform: scrollY ? [{ translateY: scrollY }, { scale: QUALITY }] : [{ scale: QUALITY }],
        },
      ]}
    >
      <Image
        source={{ uri: photo.uri }}
        blurRadius={(photo.blur + blur) / QUALITY}
        style={[styles.photo, scaled(photoFrame(photo, window))]}
      />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: `rgba(0, 0, 0, ${photo.dim})` }]} />
    </Animated.View>
  );
}

function scaled(frame: { left: number; top: number; width: number; height: number }) {
  return {
    left: frame.left / QUALITY,
    top: frame.top / QUALITY,
    width: frame.width / QUALITY,
    height: frame.height / QUALITY,
  };
}

const styles = StyleSheet.create({
  clip: {
    overflow: 'hidden',
    borderCurve: 'continuous',
  },
  copy: {
    position: 'absolute',
    overflow: 'hidden',
    transformOrigin: 'top left',
  },
  photo: {
    position: 'absolute',
  },
  dim: {
    backgroundColor: `rgba(0, 0, 0, ${CARD_DIM})`,
  },
});
