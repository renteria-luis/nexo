import { memo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Polyline, Text as SvgText } from 'react-native-svg';

import { agencyClock } from '../transit/schedule.ts';
import { Bus } from './icons.ts';
import { placeIcon } from './placeIcons.ts';
import type { TransitMapProps } from './TransitMap.types.ts';
import { font } from './theme.ts';
import { useReportedBuses } from './useReportedBuses.ts';

export const TransitMap = memo(function TransitMap({
  center,
  places,
  stops,
  selectedPlace,
  selectedStop,
  draft,
  buses,
  routePoints = [],
  routeColor = '#3977A5',
  onPlace,
  onStop,
  onPoint,
}: TransitMapProps) {
  const reports = useReportedBuses(buses);
  const [width, setWidth] = useState(320);
  const [zoom, setZoom] = useState(1);
  const height = 250;
  const x = (lng: number) => width / 2 + ((lng - center.lng) / 0.015) * width * zoom;
  const y = (lat: number) => height / 2 - ((lat - center.lat) / 0.012) * height * zoom;
  const visible = (lat: number, lng: number) =>
    x(lng) >= 0 && x(lng) <= width && y(lat) >= 0 && y(lat) <= height;
  return (
    <View>
      <Text style={styles.caption}>Vista de puntos · el mapa de Apple se muestra en iPhone</Text>
      <Pressable
        accessibilityLabel={
          onPoint ? 'Elegir coordenadas en la vista de puntos' : 'Vista de lugares y paradas'
        }
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        style={styles.frame}
        onPress={(e) => {
          if (!onPoint) return;
          // React Native Web's press callback supplies a DOM mouse event, not touch-local coordinates.
          const pointer = e.nativeEvent as unknown as MouseEvent;
          if (!Number.isFinite(pointer.clientX) || !Number.isFinite(pointer.clientY)) return;
          const bounds = (e.currentTarget as unknown as HTMLElement).getBoundingClientRect();
          onPoint({
            lat:
              center.lat - (((pointer.clientY - bounds.top - height / 2) / height) * 0.012) / zoom,
            lng:
              center.lng + (((pointer.clientX - bounds.left - width / 2) / width) * 0.015) / zoom,
          });
        }}
      >
        <Svg width={width} height={height} pointerEvents="none">
          {[1, 2, 3, 4].map((i) => (
            <Line
              key={`x${i}`}
              x1={(i * width) / 5}
              x2={(i * width) / 5}
              y1={0}
              y2={height}
              stroke="#D3D8D5"
            />
          ))}
          {routePoints.length > 1 && (
            <Polyline
              points={routePoints.map((p) => `${x(p.lng)},${y(p.lat)}`).join(' ')}
              fill="none"
              stroke={routeColor}
              strokeWidth={3}
            />
          )}
          {[1, 2, 3, 4].map((i) => (
            <Line
              key={`y${i}`}
              x1={0}
              x2={width}
              y1={(i * height) / 5}
              y2={(i * height) / 5}
              stroke="#D3D8D5"
            />
          ))}
          {stops
            .filter((s) => visible(s[3], s[4]))
            .map((s) => (
              <Circle
                key={s[0]}
                cx={x(s[4])}
                cy={y(s[3])}
                r={s[0] === selectedStop ? 9 : 6}
                fill={s[0] === selectedStop ? '#DA692F' : '#9B728D'}
              />
            ))}
          {places
            .filter((p) => visible(p.lat, p.lng))
            .map((p) => (
              <Circle
                key={p.id}
                cx={x(p.lng)}
                cy={y(p.lat)}
                r={p.id === selectedPlace ? 14 : 12}
                fill={p.id === selectedPlace ? '#17683A' : '#3977A5'}
              />
            ))}
          {draft && (
            <Circle
              cx={x(draft.lng)}
              cy={y(draft.lat)}
              r={10}
              fill="#DA692F"
              stroke="#111"
              strokeWidth={2}
            />
          )}
          {reports
            .filter((bus) => visible(bus.lat, bus.lng))
            .map((bus) => (
              <Circle
                key={`bus-${bus.id}`}
                cx={x(bus.lng)}
                cy={y(bus.lat)}
                r={12}
                fill={bus.stale ? '#777777' : '#C34438'}
                stroke="#FFFFFF"
                strokeWidth={2}
              />
            ))}
          <SvgText x={8} y={height - 10} fontSize={11} fill="#46514B">
            N ↑ · puntos, sin calles ni recorridos a pie
          </SvgText>
        </Svg>
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          {stops
            .filter((s) => visible(s[3], s[4]))
            .map((s) => (
              <Pressable
                key={s[0]}
                accessibilityRole="button"
                accessibilityLabel={s[2]}
                style={[styles.marker, { left: x(s[4]) - 14, top: y(s[3]) - 14 }]}
                onPress={(event) => {
                  event.stopPropagation();
                  onStop(s[0]);
                }}
              />
            ))}
          {places
            .filter((p) => visible(p.lat, p.lng))
            .map((p) => {
              const Icon = placeIcon(p.icon);
              return (
                <Pressable
                  key={p.id}
                  accessibilityRole="button"
                  accessibilityLabel={p.name}
                  style={[styles.marker, { left: x(p.lng) - 14, top: y(p.lat) - 14 }]}
                  onPress={(event) => {
                    event.stopPropagation();
                    onPlace(p.id);
                  }}
                >
                  <Icon size={14} color="#FFFFFF" strokeWidth={2.5} />
                </Pressable>
              );
            })}
          {reports
            .filter((bus) => visible(bus.lat, bus.lng))
            .map((bus) => (
              <View
                key={`bus-${bus.id}`}
                pointerEvents="none"
                style={[styles.marker, { left: x(bus.lng) - 14, top: y(bus.lat) - 14 }]}
              >
                <Bus size={14} color="#FFFFFF" strokeWidth={2.5} />
              </View>
            ))}
        </View>
        <View style={styles.controls}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Acercar puntos"
            style={styles.control}
            disabled={zoom === 8}
            onPress={(event) => {
              event.stopPropagation();
              setZoom((z) => Math.min(8, z * 2));
            }}
          >
            <Text style={styles.controlText}>+</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Alejar puntos"
            style={styles.control}
            disabled={zoom === 1}
            onPress={(event) => {
              event.stopPropagation();
              setZoom((z) => Math.max(1, z / 2));
            }}
          >
            <Text style={styles.controlText}>−</Text>
          </Pressable>
        </View>
      </Pressable>
      {reports.map((bus) => (
        <Text key={bus.id} style={styles.caption}>
          {bus.label} · {bus.stale ? 'último reporte' : 'posición reportada'} ·{' '}
          {bus.measuredAt === null ? 'sin hora de medición' : agencyClock(bus.measuredAt)}
        </Text>
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  controls: { position: 'absolute', right: 6, top: 6, gap: 4 },
  control: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    borderWidth: 1,
    backgroundColor: '#FFFFFF',
    borderColor: '#46514B',
  },
  controlText: { fontFamily: font.bold, fontSize: 22, color: '#46514B' },
  marker: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  frame: { height: 250, backgroundColor: '#EEF2EF', borderRadius: 10, overflow: 'hidden' },
  caption: { fontFamily: font.regular, fontSize: 12, marginBottom: 6, color: '#46514B' },
});
