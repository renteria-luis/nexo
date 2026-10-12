import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import {
  addDays,
  daysBetween,
  shortDay,
  shortMonth,
  weekday,
  type IsoDate,
} from '../core/dates.ts';
import { Button } from './Button.tsx';
import { CalendarClock, ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from './icons.ts';
import { TextField } from './TextField.tsx';
import { font, shape, sheet, theme } from './theme.ts';

const WEEK = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

function stepClock(clock: string, minutes: number) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(clock);
  const total = match ? Number(match[1]) * 60 + Number(match[2]) : 0;
  const next = Math.min(23 * 60 + 59, Math.max(0, total + minutes));
  return `${String(Math.floor(next / 60)).padStart(2, '0')}:${String(next % 60).padStart(2, '0')}`;
}

/**
 * When the departures are for: now, live, or a chosen day and time from the saved schedule.
 * Closed it is one line; open it shows the month and the hour.
 */
export function TransitWhen({
  live,
  date,
  clock,
  today,
  validFrom,
  validTo,
  onDate,
  onClock,
  onApply,
  onNow,
}: {
  live: boolean;
  date: IsoDate;
  clock: string;
  today: IsoDate;
  validFrom: IsoDate;
  validTo: IsoDate;
  onDate: (date: IsoDate) => void;
  onClock: (clock: string) => void;
  onApply: () => boolean;
  onNow: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => `${date.slice(0, 7)}-01`);
  const lead = weekday(month) - 1;
  const length = daysBetween(month, `${addDays(month, 32).slice(0, 7)}-01`);
  const days = Array.from({ length: lead + length }, (_, i) =>
    i < lead ? null : addDays(month, i - lead),
  );
  const Chevron = open ? ChevronUp : ChevronDown;
  return (
    <View style={styles.when}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel="Elegir día y hora de las salidas"
        onPress={() => setOpen(!open)}
        style={styles.toggle}
      >
        <CalendarClock size={16} color={theme.text} strokeWidth={2.5} />
        <Text style={[styles.toggleText, styles.grow]}>
          {live ? 'Ahora · en vivo' : `${date === today ? 'Hoy' : shortDay(date)} · ${clock}`}
        </Text>
        <Chevron size={16} color={theme.text} strokeWidth={2.5} />
      </Pressable>
      {open && (
        <View style={styles.panel}>
          <View style={styles.monthHead}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Mes anterior"
              hitSlop={8}
              disabled={month <= `${validFrom.slice(0, 7)}-01`}
              onPress={() => setMonth(`${addDays(month, -1).slice(0, 7)}-01`)}
              style={styles.monthStep}
            >
              <ChevronLeft size={18} color={theme.text} strokeWidth={2.5} />
            </Pressable>
            <Text style={[styles.monthTitle, styles.grow]}>
              {shortMonth(month)} {month.slice(0, 4)}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Mes siguiente"
              hitSlop={8}
              disabled={addDays(month, length) > validTo}
              onPress={() => setMonth(addDays(month, length))}
              style={styles.monthStep}
            >
              <ChevronRight size={18} color={theme.text} strokeWidth={2.5} />
            </Pressable>
          </View>
          <View style={styles.grid}>
            {WEEK.map((name, i) => (
              <Text key={`w${i}`} style={styles.weekday}>
                {name}
              </Text>
            ))}
            {days.map((day, i) =>
              day === null ? (
                <View key={`e${i}`} style={styles.cell} />
              ) : (
                <Pressable
                  key={day}
                  accessibilityRole="button"
                  accessibilityLabel={shortDay(day)}
                  accessibilityState={{ selected: day === date }}
                  disabled={day < validFrom || day > validTo}
                  onPress={() => onDate(day)}
                  style={[
                    styles.cell,
                    styles.day,
                    day === today && styles.today,
                    day === date && styles.chosen,
                    (day < validFrom || day > validTo) && styles.outside,
                  ]}
                >
                  <Text style={[styles.dayText, day === date && styles.chosenText]}>
                    {Number(day.slice(8))}
                  </Text>
                </Pressable>
              ),
            )}
          </View>
          <View style={styles.time}>
            <Button
              label="−15"
              variant="ghost"
              accessibilityLabel="Quince minutos antes"
              onPress={() => onClock(stepClock(clock, -15))}
            />
            <TextField
              accessibilityLabel="Hora de las salidas"
              value={clock}
              onChange={onClock}
              placeholder="HH:MM"
              style={styles.clock}
            />
            <Button
              label="+15"
              variant="ghost"
              accessibilityLabel="Quince minutos después"
              onPress={() => onClock(stepClock(clock, 15))}
            />
          </View>
          <View style={styles.actions}>
            <Button
              label="Ahora"
              variant="ghost"
              onPress={() => {
                onNow();
                setOpen(false);
              }}
            />
            <Button
              label="Ver horarios"
              variant="primary"
              onPress={() => {
                if (onApply()) setOpen(false);
              }}
            />
          </View>
        </View>
      )}
    </View>
  );
}

const CELL = `${100 / 7}%` as const;

const styles = sheet((theme) => ({
  when: { gap: 8 },
  grow: { flex: 1 },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 12,
    borderWidth: shape.border,
    borderColor: theme.line,
    borderRadius: shape.radiusSmall,
    backgroundColor: theme.surface,
  },
  toggleText: { fontFamily: font.bold, fontSize: 14, color: theme.text },
  panel: {
    gap: 10,
    padding: 10,
    borderWidth: shape.border,
    borderColor: theme.line,
    borderRadius: shape.radius,
    backgroundColor: theme.surface,
  },
  monthHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  monthStep: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  monthTitle: { fontFamily: font.black, fontSize: 15, color: theme.text, textAlign: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  weekday: {
    width: CELL,
    textAlign: 'center',
    fontFamily: font.bold,
    fontSize: 12,
    color: theme.textFaint,
    paddingBottom: 4,
  },
  cell: { width: CELL, height: 38, alignItems: 'center', justifyContent: 'center' },
  day: { borderRadius: shape.radiusSmall },
  today: { borderWidth: shape.border, borderColor: theme.lineSoft },
  chosen: { backgroundColor: theme.accent, borderWidth: shape.border, borderColor: theme.line },
  outside: { opacity: 0.3 },
  dayText: { fontFamily: font.bold, fontSize: 14, color: theme.text },
  chosenText: { fontFamily: font.black, color: theme.accentInk },
  time: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  clock: {
    flex: 1,
    textAlign: 'center',
    fontFamily: font.bold,
    fontSize: 16,
    color: theme.text,
    borderWidth: shape.border,
    borderColor: theme.lineSoft,
    borderRadius: shape.radiusSmall,
    minHeight: 44,
    backgroundColor: theme.surface,
  },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
}));
