import { memo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Polyline, Text as SvgText } from 'react-native-svg';

import { agencyClock } from '../transit/schedule.ts';
import { mapRegion } from '../transit/map.ts';
import { Bus } from './icons.ts';
import { placeIcon } from './placeIcons.ts';
import { stopChoiceColor } from './routeColors.ts';
import type { TransitMapProps } from './TransitMap.types.ts';
import { font } from './theme.ts';

export const TransitMap = memo(function TransitMap({
  center,
  places,
  stops,
  selectedPlace,
  selectedPlaces = [],
  selectedStop,
  draft,
  buses = [],
  followed,
  focus,
  viewport,
  journeyPaths = [],
  stopDots = [],
  routePoints = [],
  routeColor = '#3977A5',
  walkPaths = [],
  notes = [],
  location,
  ends = [],
  choices = [],
  onChoice,
  onNote,
  onPlace,
  onStop,
  onPoint,
}: TransitMapProps) {
  const [width, setWidth] = useState(320);
  const [zoom, setZoom] = useState(1);
  // The diagram centres on the place, or once on a bus he tapped, until the place changes.
  const [view, setView] = useState({
    key: focus?.key ?? null,
    at: focus?.point ?? center,
    from: center,
    viewportKey: viewport?.key,
    region: viewport?.points.length ? mapRegion(viewport.points) : null,
  });
  let shown = view;
  if (viewport?.key !== view.viewportKey)
    shown = {
      ...view,
      at: center,
      from: center,
      viewportKey: viewport?.key,
      region: viewport?.points.length ? mapRegion(viewport.points) : null,
    };
  else if (focus && focus.key !== view.key)
    shown = { ...view, key: focus.key, at: focus.point, from: center, region: null };
  else if (view.from.lat !== center.lat || view.from.lng !== center.lng)
    shown = { ...view, at: center, from: center };
  if (shown !== view) {
    setView(shown);
    setZoom(1);
  }
  const middle = shown.region?.center ?? shown.at;
  const latDelta = shown.region?.latDelta ?? 0.012;
  const lngDelta = shown.region?.lngDelta ?? 0.015;
  const height = 250;
  const x = (lng: number) => width / 2 + ((lng - middle.lng) / lngDelta) * width * zoom;
  const y = (lat: number) => height / 2 - ((lat - middle.lat) / latDelta) * height * zoom;
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
              middle.lat -
              (((pointer.clientY - bounds.top - height / 2) / height) * latDelta) / zoom,
            lng:
              middle.lng +
              (((pointer.clientX - bounds.left - width / 2) / width) * lngDelta) / zoom,
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
          {journeyPaths
            .filter((path) => path.points.length > 1)
            .map((path) => (
              <Polyline
                key={path.id}
                points={path.points.map((p) => `${x(p.lng)},${y(p.lat)}`).join(' ')}
                fill="none"
                stroke={path.color}
                strokeWidth={3}
                strokeDasharray={path.dashed ? '7 5' : undefined}
              />
            ))}
          {walkPaths
            .filter((path) => path.points.length > 1)
            .map((path) => (
              <Polyline
                key={`walk-${path.id}`}
                points={path.points.map((p) => `${x(p.lng)},${y(p.lat)}`).join(' ')}
                fill="none"
                stroke={path.drawing ? '#DA692F' : '#17683A'}
                strokeWidth={3}
                strokeDasharray="7 5"
              />
            ))}
          {stopDots
            .filter((dot) => visible(dot.lat, dot.lng))
            .map((dot) => (
              <Circle
                key={`dot-${dot.id}`}
                cx={x(dot.lng)}
                cy={y(dot.lat)}
                r={dot.alight ? 7 : 4}
                fill={dot.skipped ? '#8A8A8A' : '#FFFFFF'}
                stroke="#111111"
                strokeWidth={dot.alight ? 3 : 2}
              />
            ))}
          {notes
            .filter((note) => visible(note.lat, note.lng))
            .map((note) => (
              <Circle
                key={`note-${note.id}`}
                cx={x(note.lng)}
                cy={y(note.lat)}
                r={9}
                fill="#A16B16"
              />
            ))}
          {location && (
            <Circle
              cx={x(location.lng)}
              cy={y(location.lat)}
              r={9}
              fill="#17683A"
              stroke="#FFFFFF"
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
                r={p.id === selectedPlace || selectedPlaces.includes(p.id) ? 14 : 12}
                fill={
                  p.id === selectedPlace || selectedPlaces.includes(p.id) ? '#17683A' : '#3977A5'
                }
              />
            ))}
          {ends
            .filter((end) => visible(end.lat, end.lng))
            .map((end) => (
              <Circle
                key={`end-${end.kind}`}
                cx={x(end.lng)}
                cy={y(end.lat)}
                r={12}
                fill="#111111"
                stroke="#FFFFFF"
                strokeWidth={2}
              />
            ))}
          {choices
            .filter((choice) => visible(choice.lat, choice.lng))
            .map((choice) => (
              <Circle
                key={`choice-${choice.id}`}
                cx={x(choice.lng)}
                cy={y(choice.lat)}
                r={choice.selected ? 15 : 12}
                fill={stopChoiceColor(choice.rank)}
                stroke="#111111"
                strokeWidth={choice.selected ? 4 : 2}
              />
            ))}
          {choices
            .filter((choice) => visible(choice.lat, choice.lng))
            .map((choice) => (
              <SvgText
                key={`choice-text-${choice.id}`}
                x={x(choice.lng)}
                y={y(choice.lat) + 5}
                fontSize={14}
                fontWeight="900"
                fill="#FFFFFF"
                textAnchor="middle"
              >
                {choice.rank ?? '×'}
              </SvgText>
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
          {buses
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
          {followed && visible(followed.lat, followed.lng) && (
            <Circle
              cx={x(followed.lng)}
              cy={y(followed.lat)}
              r={17}
              fill="#FFFFFF"
              stroke={followed.placedBy === 'last-gps' ? '#777777' : '#111111'}
              strokeWidth={3}
              strokeDasharray={followed.placedBy === 'estimate' ? '5 4' : undefined}
            />
          )}
          <SvgText x={8} y={height - 10} fontSize={11} fill="#46514B">
            N ↑ · puntos y caminos personales, sin calles
          </SvgText>
        </Svg>
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          {notes
            .filter((note) => visible(note.lat, note.lng))
            .map((note) => (
              <Pressable
                key={`note-${note.id}`}
                accessibilityRole="button"
                accessibilityLabel={`Cruce: ${note.note || note.kind}`}
                style={[styles.marker, { left: x(note.lng) - 14, top: y(note.lat) - 14 }]}
                onPress={(event) => {
                  event.stopPropagation();
                  onNote?.(note.id);
                }}
              />
            ))}
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
                  style={[
                    styles.marker,
                    {
                      left: x(p.lng) - 14,
                      top: y(p.lat) - 14,
                      zIndex: p.id === selectedPlace || selectedPlaces.includes(p.id) ? 20 : 10,
                    },
                  ]}
                  onPress={(event) => {
                    event.stopPropagation();
                    onPlace(p.id);
                  }}
                >
                  <Icon size={14} color="#FFFFFF" strokeWidth={2.5} />
                </Pressable>
              );
            })}
          {choices
            .filter((choice) => visible(choice.lat, choice.lng))
            .map((choice) => (
              <Pressable
                key={`choice-${choice.id}`}
                accessibilityRole="button"
                accessibilityLabel={choice.label}
                style={[
                  styles.marker,
                  { left: x(choice.lng) - 14, top: y(choice.lat) - 14, zIndex: 30 },
                ]}
                onPress={(event) => {
                  event.stopPropagation();
                  onChoice?.(choice.id);
                }}
              />
            ))}
          {buses
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
          {followed && visible(followed.lat, followed.lng) && (
            <View
              pointerEvents="none"
              accessibilityLabel={followed.label}
              style={[styles.followed, { left: x(followed.lng) - 56, top: y(followed.lat) - 14 }]}
            >
              <Bus size={16} color="#111111" strokeWidth={2.5} />
              <Text style={styles.followedTag}>{followed.tag}</Text>
            </View>
          )}
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
      {followed && <Text style={styles.caption}>{followed.label}</Text>}
      {buses.map((bus) => (
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
  followed: { position: 'absolute', width: 112, alignItems: 'center' },
  followedTag: {
    marginTop: 6,
    paddingHorizontal: 4,
    fontFamily: font.bold,
    fontSize: 11,
    color: '#111111',
    backgroundColor: '#FFFFFF',
  },
  frame: { height: 250, backgroundColor: '#EEF2EF', borderRadius: 10, overflow: 'hidden' },
  caption: { fontFamily: font.regular, fontSize: 12, marginBottom: 6, color: '#46514B' },
});
