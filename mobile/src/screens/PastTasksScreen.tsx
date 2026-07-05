/**
 * PastTasksScreen — browse everything saved in overwhelmMemory, grouped by the
 * topic the model tagged each task with. View-only for v1 (no edit/delete) —
 * tap a task to expand/collapse its steps inline.
 *
 * PRIVACY: reads only the on-device overwhelm_memory.json. No network.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { overwhelmMemory, type MemoryEntry } from '../features/overwhelm/overwhelmMemory';
import { color, layout, radii, space, type } from '../theme/tokens';

type Props = { onBack: () => void };

export function PastTasksScreen({ onBack }: Props) {
  const [entries, setEntries] = useState<MemoryEntry[] | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  useEffect(() => {
    overwhelmMemory.list().then(setEntries);
  }, []);

  const groups = useMemo(() => {
    if (!entries) return [];
    const byCategory = new Map<string, MemoryEntry[]>();
    for (const e of entries) {
      const list = byCategory.get(e.category) ?? [];
      list.push(e);
      byCategory.set(e.category, list);
    }
    return Array.from(byCategory.entries());
  }, [entries]);

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.content}>
          <Pressable
            onPress={onBack}
            hitSlop={12}
            style={styles.backRow}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Text style={styles.backChevron}>‹</Text>
            <Text style={styles.backLabel}>Past Tasks</Text>
          </Pressable>

          {entries && entries.length === 0 && (
            <Text style={styles.empty}>
              Nothing saved yet — breakdowns you complete will show up here, grouped
              by topic.
            </Text>
          )}

          {groups.map(([topic, items]) => (
            <View key={topic} style={styles.group}>
              <Text style={styles.groupTitle}>{topic}</Text>
              {items.map((e) => {
                const id = e.savedAt;
                const open = expandedId === id;
                return (
                  <Pressable
                    key={id}
                    onPress={() => setExpandedId(open ? null : id)}
                    style={styles.card}
                    accessibilityRole="button"
                  >
                    <Text style={styles.taskText}>{e.taskText}</Text>
                    <Text style={styles.meta}>
                      {e.completedSteps}/{e.totalSteps} steps done · {new Date(e.savedAt).toLocaleDateString()}
                    </Text>
                    {open && (
                      <View style={styles.stepsList}>
                        {e.steps.map((s, i) => (
                          <Text key={i} style={styles.stepLine}>
                            · {s}
                          </Text>
                        ))}
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.background },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: layout.screenPaddingH,
    paddingTop: space[6],
    paddingBottom: space[7],
  },
  content: { width: '100%', maxWidth: layout.maxContentWidth, alignSelf: 'center' },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
    marginBottom: space[5],
    alignSelf: 'flex-start',
    minHeight: 44,
  },
  backChevron: { fontSize: 22, color: color.accent },
  backLabel: { ...type.body, color: color.accent, fontWeight: '600' as const },
  empty: { ...type.subtext, color: color.textSecondary, textAlign: 'center', marginTop: space[7] },
  group: { marginBottom: space[6] },
  groupTitle: { ...type.h2, color: color.textPrimary, marginBottom: space[3] },
  card: {
    backgroundColor: color.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: color.border,
    padding: space[4],
    marginBottom: space[3],
  },
  taskText: { ...type.body, color: color.textPrimary },
  meta: { ...type.caption, color: color.textTertiary, marginTop: space[1] },
  stepsList: { marginTop: space[3], gap: space[1] },
  stepLine: { ...type.subtext, color: color.textSecondary },
});

export default PastTasksScreen;
