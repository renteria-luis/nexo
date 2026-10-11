import { memo, useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';

import { agencyClock } from '../transit/schedule.ts';
import { Bus } from './icons.ts';
import { placeIcon } from './placeIcons.ts';
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
        {places.map((p) => {
          const Icon = placeIcon(p.icon);
          return (
            <Marker
              key={p.id}
              identifier={p.id}
              coordinate={{ latitude: p.lat, longitude: p.lng }}
              title={p.name}
              anchor={{ x: 0.5, y: 0.5 }}
              onPress={() => onPlace(p.id)}
            >
              <View style={[styles.place, p.id === selectedPlace && styles.placeChosen]}>
                <Icon size={16} color="#FFFFFF" strokeWidth={2.5} />
              </View>
            </Marker>
          );
        })}
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
            anchor={{ x: 0.5, y: 0.5 }}
            zIndex={3}
          >
            <View style={[styles.bus, bus.stale && styles.busStale]}>
              <Bus size={14} color="#FFFFFF" strokeWidth={2.5} />
            </View>
          </Marker>
        ))}
      </MapView>
    </View>
  );
});

const marker = {
  alignItems: 'center',
  justifyContent: 'center',
  borderWidth: 2,
  borderColor: '#FFFFFF',
} as const;

const styles = StyleSheet.create({
  frame: { height: 280, overflow: 'hidden', borderRadius: 10 },
  place: { ...marker, width: 30, height: 30, borderRadius: 15, backgroundColor: '#3977A5' },
  placeChosen: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#17683A' },
  bus: { ...marker, width: 28, height: 28, borderRadius: 14, backgroundColor: '#C34438' },
  busStale: { backgroundColor: '#777777' },
});
