import { memo, useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';

import { agencyClock } from '../transit/schedule.ts';
import { useSwipeLock } from './SwipeLock.tsx';
import { useReportedBuses } from './useReportedBuses.ts';
import type { TransitMapProps } from './TransitMap.types.ts';

export const TransitMap = memo(function TransitMap({
  center,
  places,
  stops,
  selectedPlace,
  selectedStop,
  draft,
  buses,
  routePoints = [],
  onPlace,
  onStop,
  onPoint,
  onInteraction,
}: TransitMapProps) {
  const reports = useReportedBuses(buses);
  const map = useRef<MapView>(null);
  const { acquire } = useSwipeLock();
  const release = useRef<(() => void) | null>(null);
  const lat = center.lat;
  const lng = center.lng;
  useEffect(() => {
    map.current?.animateToRegion(
      { latitude: lat, longitude: lng, latitudeDelta: 0.012, longitudeDelta: 0.012 },
      250,
    );
  }, [lat, lng]);
  useEffect(() => () => release.current?.(), []);
  const end = () => {
    release.current?.();
    release.current = null;
    onInteraction?.(false);
  };
  return (
    <View style={styles.frame}>
      <MapView
        ref={map}
        style={StyleSheet.absoluteFill}
        initialRegion={{
          latitude: lat,
          longitude: lng,
          latitudeDelta: 0.012,
          longitudeDelta: 0.012,
        }}
        onTouchStart={() => {
          release.current ??= acquire();
          onInteraction?.(true);
        }}
        onTouchEnd={(event) => {
          if (event.nativeEvent.touches.length === 0) end();
        }}
        onTouchCancel={end}
        onPress={(event) => {
          if (event.nativeEvent.action !== 'marker-press')
            onPoint?.({
              lat: event.nativeEvent.coordinate.latitude,
              lng: event.nativeEvent.coordinate.longitude,
            });
        }}
        rotateEnabled={false}
        pitchEnabled={false}
        toolbarEnabled={false}
      >
        {routePoints.length > 1 && (
          <Polyline
            coordinates={routePoints.map((p) => ({ latitude: p.lat, longitude: p.lng }))}
            strokeColor="#3977A5"
            strokeWidth={4}
          />
        )}
        {places.map((p) => (
          <Marker
            key={p.id}
            identifier={p.id}
            coordinate={{ latitude: p.lat, longitude: p.lng }}
            title={p.name}
            pinColor={p.id === selectedPlace ? '#17683A' : '#3977A5'}
            onPress={() => onPlace(p.id)}
          />
        ))}
        {stops.map((s) => (
          <Marker
            key={s[0]}
            identifier={s[0]}
            coordinate={{ latitude: s[3], longitude: s[4] }}
            title={s[2]}
            description={`${s[0]} · ${s[1] || 'sin código público'}`}
            pinColor={s[0] === selectedStop ? '#DA692F' : '#9B728D'}
            onPress={() => onStop(s[0])}
          />
        ))}
        {draft && (
          <Marker
            coordinate={{ latitude: draft.lat, longitude: draft.lng }}
            title="Punto por guardar"
            pinColor="#DA692F"
          />
        )}
        {reports.map((bus) => (
          <Marker
            key={`bus-${bus.id}`}
            identifier={`bus-${bus.id}`}
            coordinate={{ latitude: bus.lat, longitude: bus.lng }}
            title={bus.label}
            description={`${bus.stale ? 'Último reporte' : 'Posición reportada'} · ${bus.measuredAt === null ? 'sin hora de medición' : agencyClock(bus.measuredAt)}`}
            pinColor={bus.stale ? '#777777' : '#C34438'}
            zIndex={3}
          />
        ))}
      </MapView>
    </View>
  );
});

const styles = StyleSheet.create({ frame: { height: 280, overflow: 'hidden', borderRadius: 10 } });
