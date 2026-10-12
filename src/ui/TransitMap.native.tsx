import { memo, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';

import { agencyClock } from '../transit/schedule.ts';
import { Bus } from './icons.ts';
import { placeIcon } from './placeIcons.ts';
import { useSwipeLock } from './SwipeLock.tsx';
import type { TransitMapProps } from './TransitMap.types.ts';

export const TransitMap = memo(function TransitMap({
  center,
  places,
  stops,
  selectedPlace,
  selectedStop,
  draft,
  buses = [],
  followed,
  focus,
  routePoints = [],
  routeColor = '#3977A5',
  onPlace,
  onStop,
  onPoint,
  onInteraction,
}: TransitMapProps) {
  const map = useRef<MapView>(null);
  const [ready, setReady] = useState(false);
  const target = useRef(focus);
  target.current = focus;
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
  // Once per tap, even to the same point, and only then: the camera does not chase the bus while
  // he pans. A tap before the map is ready waits for it.
  const focusKey = focus?.key;
  useEffect(() => {
    const point = target.current?.point;
    if (!ready || focusKey === undefined || !point) return;
    map.current?.animateToRegion(
      { latitude: point.lat, longitude: point.lng, latitudeDelta: 0.008, longitudeDelta: 0.008 },
      400,
    );
  }, [focusKey, ready]);
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
        onMapReady={() => setReady(true)}
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
            strokeColor={routeColor}
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
        {buses.map((bus) => (
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
        {followed && (
          <Marker
            key="followed"
            identifier="followed"
            coordinate={{ latitude: followed.lat, longitude: followed.lng }}
            title={followed.label}
            description={
              followed.measuredAt === null
                ? 'sin hora de GPS'
                : `GPS de las ${agencyClock(followed.measuredAt)}`
            }
            // The circle's centre, above the tag, sits on the point.
            anchor={{ x: 0.5, y: 0.34 }}
            zIndex={4}
          >
            <View style={styles.followed}>
              <View
                style={[
                  styles.followedBus,
                  followed.placedBy === 'last-gps' && styles.followedLast,
                  followed.placedBy === 'estimate' && styles.followedEstimate,
                ]}
              >
                <Bus size={18} color="#111111" strokeWidth={2.5} />
              </View>
              <Text style={styles.followedTag}>{followed.tag}</Text>
            </View>
          </Marker>
        )}
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
  // His bus is told apart by size, a white face, a black ring and its tag, not only by colour.
  followed: { alignItems: 'center', width: 112 },
  followedBus: {
    ...marker,
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 3,
    borderColor: '#111111',
    backgroundColor: '#FFFFFF',
  },
  followedLast: { borderColor: '#777777' },
  followedEstimate: { borderStyle: 'dashed' },
  followedTag: {
    marginTop: 2,
    paddingHorizontal: 4,
    borderRadius: 4,
    overflow: 'hidden',
    fontSize: 11,
    fontWeight: '700',
    color: '#111111',
    backgroundColor: '#FFFFFF',
  },
});
