import { useEffect, useState } from 'react';
import { Image, PixelRatio, StyleSheet, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';

import { PhotoCopy, QUALITY } from './CardFrost.tsx';
import { BLUR, type ScreenBlurProps } from './ScreenBlur.tsx';

/**
 * La pantalla desenfocada detras de una hoja, en el telefono (2026-10-18, a peticion
 * suya): al abrirse, una foto de lo que se ve, tomada a un cuarto del tamano y agrandada,
 * desenfocada por la app como las tarjetas. Los desenfoques de iOS 26 ya fallaron en las
 * tarjetas; este no depende de ellos.
 *
 * La foto es solo del contenido, porque la hoja ya esta encima del marco al tomarla; el
 * fondo de la pantalla queda en los huecos. Si es una foto, aqui va otra vez desenfocada,
 * porque si no se veria nitida entre las tarjetas borrosas. Un degradado o unas manchas
 * se ven igual desenfocados.
 *
 * Se monta al abrir la hoja y se desmonta al cerrarla: cada vez que se abre, foto nueva.
 */
export function ScreenBlur({ target, frame, background }: ScreenBlurProps) {
  const [spot, setSpot] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const [shot, setShot] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    frame.current?.measureInWindow((x, y, width, height) => {
      if (!alive || width === 0 || height === 0) return;
      setSpot({ left: -x, top: -y, width, height });
      // En iOS el tamano pedido va en puntos y la foto sale a la densidad de la pantalla:
      // dividido por ella, cada punto del cuarto de tamano es un pixel, como en la web.
      const ratio = PixelRatio.get();
      captureRef(target, {
        format: 'png',
        result: 'data-uri',
        width: width / (QUALITY * ratio),
        height: height / (QUALITY * ratio),
      }).then(
        (uri) => {
          if (alive) setShot(uri);
        },
        (error: unknown) => console.error(error),
      );
    });
    return () => {
      alive = false;
    };
  }, [target, frame]);

  if (spot === null) return null;
  return (
    <View pointerEvents="none" style={styles.clip}>
      {background.kind === 'photo' && (
        <PhotoCopy photo={background} left={spot.left} top={spot.top} blur={BLUR} />
      )}
      {shot !== null && (
        <Image
          source={{ uri: shot }}
          blurRadius={BLUR / QUALITY}
          style={[
            styles.shot,
            {
              width: spot.width / QUALITY,
              height: spot.height / QUALITY,
              transform: [{ scale: QUALITY }],
            },
          ]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  clip: {
    ...StyleSheet.absoluteFill,
    overflow: 'hidden',
  },
  shot: {
    position: 'absolute',
    left: 0,
    top: 0,
    transformOrigin: 'top left',
  },
});
