import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import type { PantryKind, PantryState } from '../../db/types.ts';
import type { NewPantryItem, PantryItem } from '../../pantry/index.ts';
import { useAppData } from '../../shell/AppData.tsx';

import { Button } from '../Button.tsx';
import { Card } from '../Card.tsx';
import { Chip } from '../Chip.tsx';
import { Plus, Trash } from '../icons.ts';
import { ConfirmButton, InfoDot, InfoText } from '../InfoBubble.tsx';
import { NumericField } from '../NumericField.tsx';
import { PantryForm } from '../PantryForm.tsx';
import { Toggle } from '../Toggle.tsx';
import { font, sheet, shape } from '../theme.ts';

import { Screen } from './Screen.tsx';

/**
 * Lo que hay en la nevera. Spec 21.
 *
 * Agrupado por la forma de tener cada cosa, porque de eso depende lo que se le puede
 * preguntar: a lo contado y lo pesado, cuanto; a lo duradero, si queda; a una especia,
 * si la hay. Pedir gramos de whey garantizaria que el numero este mal.
 *
 * Nada de esto se descuenta solo. Cocinar una receta si descuenta lo que se midio, y
 * comerse una porcion no toca nada: cocina de paquetes que la app no vio.
 */
const GROUPS: { kind: PantryKind; title: string; note: string }[] = [
  { kind: 'counted', title: 'Contado', note: 'Huevos, hamburguesas, latas' },
  { kind: 'weighed', title: 'Pesado', note: 'Arroz, pollo, leche' },
  { kind: 'durable', title: 'Dura', note: 'Whey, aceite, mantequilla' },
  { kind: 'spice', title: 'Especias', note: 'Sal, pimienta, orégano' },
];

const STATES: PantryState[] = ['hay', 'poco', 'no hay'];

export function PantryScreen() {
  const { loadPantry, savePantryItem, removePantryItem } = useAppData();
  const [items, setItems] = useState<PantryItem[] | null>(null);
  const [editing, setEditing] = useState<PantryItem | null>(null);
  const [creating, setCreating] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(() => {
    loadPantry()
      .then(setItems)
      .catch((error: unknown) => console.error(error));
  }, [loadPantry]);

  useEffect(reload, [reload]);

  const write = (item: NewPantryItem) => {
    // Se pinta antes de que la escritura vuelva: una casilla que espera a la base se
    // lee como un boton trabado.
    if (item.id !== undefined) {
      setItems((before) =>
        (before ?? []).map((one) => (one.id === item.id ? { ...one, ...item, id: one.id } : one)),
      );
    }
    setProblem(null);
    savePantryItem(item)
      .then(() => {
        if (item.id === undefined) reload();
      })
      .catch((error: unknown) => {
        console.error(error);
        // Lo pintado por adelantado vuelve a lo guardado, y se dice por que.
        setProblem(error instanceof Error ? error.message : String(error));
        reload();
      });
  };

  const open = creating || editing !== null;

  return (
    <Screen
      title="Despensa"
      onOverlayDismiss={
        open
          ? () => {
              setCreating(false);
              setEditing(null);
            }
          : undefined
      }
      overlay={
        open ? (
          <PantryForm
            item={editing}
            onCancel={() => {
              setCreating(false);
              setEditing(null);
            }}
            onSave={(item) => {
              write(item);
              setCreating(false);
              setEditing(null);
            }}
          />
        ) : null
      }
    >
      <Button
        label="Agregar algo"
        accessibilityLabel="Agregar algo a la despensa"
        variant="primary"
        icon={Plus}
        block
        onPress={() => setCreating(true)}
      />

      {problem && <Text style={styles.problem}>{problem}</Text>}
      {notice && <Text style={styles.notice}>{notice}</Text>}

      {items === null
        ? null
        : GROUPS.map((group) => {
            const mine = items.filter((item) => item.kind === group.kind);
            return (
              <Card key={group.kind} title={group.title}>
                {mine.length === 0 ? (
                  <Text style={styles.empty}>{group.note}</Text>
                ) : (
                  mine.map((item, index) => (
                    <View key={item.id} style={[styles.row, index > 0 && styles.ruled]}>
                      <View style={styles.head}>
                        <Text style={styles.name} onPress={() => setEditing(item)}>
                          {item.name}
                        </Text>
                        {item.foodId === null && (
                          <InfoDot accessibilityLabel={`${item.name} no tiene ficha`}>
                            <InfoText>
                              {
                                'Sin alimento del catálogo.\nUna receta con esto no puede calcular sus macros ni dejar el lote.'
                              }
                            </InfoText>
                          </InfoDot>
                        )}
                        <ConfirmButton
                          icon={Trash}
                          question={`¿Quitar ${item.name} de la despensa?`}
                          accessibilityLabel={`Quitar ${item.name}`}
                          onConfirm={() => {
                            setItems((before) =>
                              (before ?? []).filter((one) => one.id !== item.id),
                            );
                            setProblem(null);
                            setNotice(null);
                            removePantryItem(item.id)
                              .then((removal) => {
                                if (removal.outcome === 'borrado') return;
                                setNotice(
                                  `${item.name} sigue en ${removal.recipes.join(', ')}: quedó sin nada para que la receta diga que falta.`,
                                );
                                reload();
                              })
                              .catch((error: unknown) => {
                                console.error(error);
                                setProblem(error instanceof Error ? error.message : String(error));
                                reload();
                              });
                          }}
                        />
                      </View>

                      {(item.kind === 'counted' || item.kind === 'weighed') && (
                        <View style={styles.amount}>
                          <NumericField
                            value={String(item.quantity ?? 0)}
                            allowDecimal={item.kind === 'weighed'}
                            accessibilityLabel={`Cuánto queda de ${item.name}`}
                            onChange={(next) =>
                              setItems((before) =>
                                (before ?? []).map((one) =>
                                  one.id === item.id
                                    ? { ...one, quantity: Number(next) || 0 }
                                    : one,
                                ),
                              )
                            }
                            onCommit={() => write({ ...item, quantity: item.quantity ?? 0 })}
                            style={styles.input}
                            focusedStyle={styles.inputWriting}
                          />
                          <Text style={styles.unit}>{item.unit}</Text>
                        </View>
                      )}

                      {item.kind === 'durable' && (
                        <View style={styles.states}>
                          {STATES.map((state) => (
                            <Chip
                              key={state}
                              label={state}
                              accessibilityLabel={`${item.name}: ${state}`}
                              selected={item.state === state}
                              onPress={() => write({ ...item, state })}
                            />
                          ))}
                        </View>
                      )}

                      {item.kind === 'spice' && (
                        <View style={styles.amount}>
                          <Toggle
                            accessibilityLabel={`¿Hay ${item.name}?`}
                            value={item.hasIt === true}
                            onChange={(next) => write({ ...item, hasIt: next })}
                          />
                          <Text style={styles.unit}>{item.hasIt ? 'hay' : 'no hay'}</Text>
                        </View>
                      )}
                    </View>
                  ))
                )}
              </Card>
            );
          })}
    </Screen>
  );
}

const styles = sheet((theme) => ({
  problem: {
    fontSize: 13,
    fontFamily: font.bold,
    color: theme.danger,
  },
  notice: {
    fontSize: 13,
    fontFamily: font.bold,
    color: theme.text,
  },
  empty: {
    fontSize: 13,
    fontFamily: font.regular,
    color: theme.textFaint,
  },
  row: {
    paddingVertical: 8,
    gap: 8,
  },
  ruled: {
    borderTopWidth: shape.border,
    borderTopColor: theme.line,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  name: {
    flex: 1,
    fontSize: 15,
    fontFamily: font.black,
    color: theme.text,
  },
  amount: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  input: {
    width: 96,
    fontSize: 16,
    fontFamily: font.black,
    color: theme.text,
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderWidth: shape.border,
    borderColor: theme.line,
    borderRadius: shape.radiusSmall,
    backgroundColor: theme.surface,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  inputWriting: {
    backgroundColor: theme.accent,
    color: theme.accentInk,
  },
  unit: {
    fontSize: 13,
    fontFamily: font.bold,
    color: theme.textDim,
  },
  states: {
    flexDirection: 'row',
    gap: 8,
  },
}));
