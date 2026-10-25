import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { addDays, daysBetween, shortDay, weekdayShort, type IsoDate } from '../core/dates.ts';
import { Button } from './Button.tsx';
import { CalendarClock, ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from './icons.ts';
import { TextField } from './TextField.tsx';
import { font, shape, sheet, theme } from './theme.ts';

const SPAN = 7;

function stepClock(clock: string, minutes: number) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(clock);
  const total = match ? Number(match[1]) * 60 + Number(match[2]) : 0;
  const next = Math.min(23 * 60 + 59, Math.max(0, total + minutes));
  return `${String(Math.floor(next / 60)).padStart(2, '0')}:${String(next % 60).padStart(2, '0')}`;
}

/**
 * When the departures are for: now, live, or a chosen day and time from the saved schedule.
 * Closed it is one line; open it shows seven days from today and the hour.
 *
 * Seven days from today and not a calendar week or a month: what he plans is tomorrow or the day
 * after, and on Sunday the Monday of the next week (2026-10-25). The month took half the screen
 * for days he never picks.
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
  label = 'Elegir día y hora de las salidas',
  applyLabel = 'Ver horarios',
  initiallyOpen = false,
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
  label?: string;
  applyLabel?: string;
  initiallyOpen?: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  // The first day there is to show: today, unless the saved schedule starts later or ended.
  const first = validFrom > today || today > validTo ? validFrom : today;
  const [start, setStart] = useState(() =>
    date < first ? first : addDays(first, SPAN * Math.floor(daysBetween(first, date) / SPAN)),
  );
  const days = Array.from({ length: SPAN }, (_, i) => addDays(start, i));
  const Chevron = open ? ChevronUp : ChevronDown;
  return (
    <View style={styles.when}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={label}
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
          <View style={styles.weekHead}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Días anteriores"
              hitSlop={8}
              disabled={start <= first}
              onPress={() => setStart(addDays(start, -SPAN))}
              style={[styles.step, start <= first && styles.outside]}
            >
              <ChevronLeft size={18} color={theme.text} strokeWidth={2.5} />
            </Pressable>
            <View style={styles.days}>
              {days.map((day) => {
                const outside = day < validFrom || day > validTo;
                const chosen = day === date;
                return (
                  <Pressable
                    key={day}
                    accessibilityRole="button"
                    accessibilityLabel={shortDay(day)}
                    accessibilityState={{ selected: chosen, disabled: outside }}
                    disabled={outside}
                    onPress={() => onDate(day)}
                    style={[
                      styles.day,
                      day === today && styles.today,
                      chosen && styles.chosen,
                      outside && styles.outside,
                    ]}
                  >
                    <Text style={[styles.dayName, chosen && styles.chosenText]}>
                      {day === today ? 'hoy' : weekdayShort(day)}
                    </Text>
                    <Text style={[styles.dayText, chosen && styles.chosenText]}>
                      {Number(day.slice(8))}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Días siguientes"
              hitSlop={8}
              disabled={addDays(start, SPAN) > validTo}
              onPress={() => setStart(addDays(start, SPAN))}
              style={[styles.step, addDays(start, SPAN) > validTo && styles.outside]}
            >
              <ChevronRight size={18} color={theme.text} strokeWidth={2.5} />
            </Pressable>
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
              label={applyLabel}
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
  weekHead: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  step: { width: 28, height: 52, alignItems: 'center', justifyContent: 'center' },
  days: { flex: 1, flexDirection: 'row', gap: 4 },
  day: {
    flex: 1,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    borderRadius: shape.radiusSmall,
  },
  today: { borderWidth: shape.border, borderColor: theme.lineSoft },
  chosen: { backgroundColor: theme.accent, borderWidth: shape.border, borderColor: theme.line },
  outside: { opacity: 0.3 },
  dayName: { fontFamily: font.bold, fontSize: 11, color: theme.textFaint },
  dayText: { fontFamily: font.bold, fontSize: 15, color: theme.text },
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
