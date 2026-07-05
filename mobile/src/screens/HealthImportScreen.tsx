/**
 * HealthImportScreen — import personal health documents (blood tests, fitness
 * reports, doctor notes) into LifePilot's on-device personal history.
 *
 * With LiteParse WASM active (iOS + Polygen):
 *   • Table-aware extraction — reads lab value tables spatially (multi-column,
 *     complex layouts, reference-range columns)
 *   • Detects scanned pages and routes to ML Kit OCR callback
 *   • Shows "Enhanced parsing active" badge so the user knows it's running
 *
 * Without LiteParse (Android / before prebuild):
 *   • Falls back to BT/ET regex extractor — works for software-generated PDFs
 *
 * PRIVACY: all parsing is on-device. Nothing is uploaded. Extracted data is
 * stored in personalHistory (local file, app sandbox only).
 */
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import React, { useState } from 'react';
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { PrimaryButton } from '../components/PrimaryButton';
import { SecondaryButton } from '../components/SecondaryButton';
import { PrivacyFootnote } from '../components/PrivacyFootnote';
import { personalHistory } from '../core/rag/personalHistory';
import { recognizeTextFromBytes } from '../core/ocr/mlkitOcr';
import { parsePdfDocument } from './healthImportUtils';
import type { LiteParseResult } from './healthImportUtils';
import { color, layout, radii, space, type } from '../theme/tokens';

type DocType = 'bloodTest' | 'fitness' | 'medication' | 'general';
type ImportState = 'idle' | 'reading' | 'review' | 'saved' | 'error';

type ParsedDoc = {
  filename: string;
  rawText: string;
  docType: DocType;
  extractedFields: ExtractedHealthFields;
  engine: 'liteparse' | 'regex-fallback';
  tableCount: number;
};

type ExtractedHealthFields = {
  possibleMetrics: string[];
  dateHints: string[];
  summary: string;
};

const DOC_TYPE_LABELS: Record<DocType, string> = {
  bloodTest: 'Blood test / lab results',
  fitness: 'Fitness / activity report',
  medication: 'Medication / prescription',
  general: 'General health note',
};

const DOC_TYPES: DocType[] = ['bloodTest', 'fitness', 'medication', 'general'];

type Props = { onBack: () => void };

export function HealthImportScreen({ onBack }: Props) {
  const [importState, setImportState] = useState<ImportState>('idle');
  const [doc, setDoc] = useState<ParsedDoc | undefined>(undefined);
  const [docType, setDocType] = useState<DocType>('general');
  const [savedCount, setSavedCount] = useState(0);

  const pickAndParse = async () => {
    setImportState('reading');
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'text/plain', 'image/*'],
        copyToCacheDirectory: true,
      });
      if (picked.canceled || !picked.assets?.length) { setImportState('idle'); return; }

      const asset = picked.assets[0];
      let parseResult: LiteParseResult | null = null;
      let rawText = '';

      if ((asset.mimeType ?? '').startsWith('image/')) {
        rawText = '[Image document — enable ML Kit OCR callback for scanned image support]';
      } else if (asset.mimeType === 'text/plain') {
        rawText = await FileSystem.readAsStringAsync(asset.uri);
      } else {
        // PDF — use liteparseService (table-aware on iOS, regex fallback on Android).
        // Pass recognizeTextFromBytes as the OCR callback so scanned pages use ML Kit.
        const b64 = await FileSystem.readAsStringAsync(asset.uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        parseResult = await parsePdfDocument(b64, {
          ocrCallback: recognizeTextFromBytes,
        });
        rawText = parseResult.text;
        if (!rawText.trim()) {
          rawText = parseResult.engine === 'liteparse'
            ? '[Scanned PDF — LiteParse detected no text layer. Wire ML Kit OCR callback to extract scanned content.]'
            : '[Scanned PDF — text layer not detected. LiteParse WASM integration will unlock full parsing on iOS.]';
        }
      }

      const fields = parseHealthFields(rawText, parseResult?.tables ?? []);
      const detected = guessDocType(rawText);

      setDoc({
        filename: asset.name ?? 'document',
        rawText,
        docType: detected,
        extractedFields: fields,
        engine: parseResult?.engine ?? 'regex-fallback',
        tableCount: parseResult?.tables?.length ?? 0,
      });
      setDocType(detected);
      setImportState('review');
    } catch {
      setImportState('error');
    }
  };

  const save = async () => {
    if (!doc) return;
    const feature = docType === 'fitness' ? 'energy' : 'hydration';
    await personalHistory.saveToday(feature, {
      source: 'healthImport',
      docType,
      filename: doc.filename,
      metrics: doc.extractedFields.possibleMetrics,
      summary: doc.extractedFields.summary,
      engine: doc.engine,
      tableCount: doc.tableCount,
      importedAt: Date.now(),
    });
    setSavedCount((n) => n + 1);
    setImportState('saved');
  };

  const reset = () => {
    setDoc(undefined);
    setImportState('idle');
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.content}>
          <Pressable onPress={onBack} hitSlop={12} style={styles.backRow} accessibilityRole="button" accessibilityLabel="Back">
            <Text style={styles.backChevron}>‹</Text>
            <Text style={styles.backLabel}>Health Import</Text>
          </Pressable>

          <Text style={styles.h1} accessibilityRole="header" maxFontSizeMultiplier={1.4}>
            Import Health Document
          </Text>
          <Text style={styles.sub} maxFontSizeMultiplier={1.4}>
            Import your own PDFs — blood tests, fitness reports, doctor notes.{'\n'}
            Parsed entirely on your device. Never uploaded.
          </Text>

          {importState === 'idle' && (
            <View style={styles.cta}>
              <PrimaryButton label="Pick a document" onPress={pickAndParse} />
              {savedCount > 0 && (
                <Text style={styles.savedNote} maxFontSizeMultiplier={1.4}>
                  {savedCount} document{savedCount > 1 ? 's' : ''} imported this session
                </Text>
              )}
            </View>
          )}

          {importState === 'reading' && (
            <View style={styles.center}>
              <Text style={styles.dim} accessibilityLiveRegion="polite">Reading document…</Text>
            </View>
          )}

          {importState === 'error' && (
            <View style={styles.center}>
              <Text style={styles.dim}>Could not read that document.</Text>
              <View style={{ height: space[4] }} />
              <SecondaryButton label="Try again" onPress={reset} />
            </View>
          )}

          {importState === 'saved' && (
            <View style={styles.center}>
              <Text style={styles.glyphLarge}>◉</Text>
              <Text style={styles.savedTitle} maxFontSizeMultiplier={1.4}>Saved to your history</Text>
              <Text style={styles.dim}>Health document storage — integration coming soon.</Text>
              <View style={{ height: space[5] }} />
              <PrimaryButton label="Import another" onPress={reset} />
            </View>
          )}

          {importState === 'review' && doc && (
            <ReviewPanel
              doc={doc}
              docType={docType}
              onTypeChange={setDocType}
              onSave={save}
              onCancel={reset}
            />
          )}

          <PrivacyFootnote text="All parsing runs on your device — nothing is uploaded." />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function ReviewPanel({
  doc, docType, onTypeChange, onSave, onCancel,
}: {
  doc: ParsedDoc;
  docType: DocType;
  onTypeChange: (t: DocType) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <View style={styles.reviewWrap}>
      <View style={styles.reviewHeader}>
        <Text style={styles.reviewTitle} maxFontSizeMultiplier={1.4} numberOfLines={2}>
          {doc.filename}
        </Text>
        {doc.engine === 'liteparse' && (
          <View style={styles.engineBadge}>
            <Text style={styles.engineBadgeText} maxFontSizeMultiplier={1}>
              ◈ Enhanced parsing
            </Text>
          </View>
        )}
      </View>

      {doc.tableCount > 0 && (
        <Text style={styles.tableNote} maxFontSizeMultiplier={1.2}>
          {doc.tableCount} table{doc.tableCount > 1 ? 's' : ''} detected and parsed
        </Text>
      )}

      {doc.extractedFields.possibleMetrics.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardLabel} maxFontSizeMultiplier={1.4}>Detected metrics</Text>
          {doc.extractedFields.possibleMetrics.slice(0, 8).map((m, i) => (
            <Text key={i} style={styles.metric} maxFontSizeMultiplier={1.4}>· {m}</Text>
          ))}
          {doc.extractedFields.possibleMetrics.length > 8 && (
            <Text style={styles.moreMetrics} maxFontSizeMultiplier={1.2}>
              + {doc.extractedFields.possibleMetrics.length - 8} more
            </Text>
          )}
        </View>
      )}

      <Text style={styles.typeLabel} maxFontSizeMultiplier={1.4}>Document type</Text>
      <View style={styles.chips}>
        {DOC_TYPES.map((t) => (
          <Pressable
            key={t}
            onPress={() => onTypeChange(t)}
            style={[styles.chip, docType === t && styles.chipOn]}
            accessibilityRole="button"
            accessibilityState={{ selected: docType === t }}
          >
            <Text style={[styles.chipText, docType === t && styles.chipTextOn]} maxFontSizeMultiplier={1.2}>
              {DOC_TYPE_LABELS[t]}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.preview}>
        <Text style={styles.previewLabel} maxFontSizeMultiplier={1.2}>Extracted text preview</Text>
        <Text style={styles.previewText} maxFontSizeMultiplier={1.2} numberOfLines={6}>
          {doc.extractedFields.summary || '(no text extracted)'}
        </Text>
      </View>

      <View style={styles.actions}>
        <PrimaryButton label="Save to my health history" onPress={onSave} />
        <View style={{ height: space[3] }} />
        <SecondaryButton label="Cancel" onPress={onCancel} />
      </View>
    </View>
  );
}

// ── Pure parsing helpers ────────────────────────────────────────────────────

/**
 * Extract health metrics from text lines and (with LiteParse) structured tables.
 * Tables give much higher accuracy for blood test results — each row is a lab
 * value with the test name, value, unit, and reference range in separate columns.
 */
function parseHealthFields(text: string, tables: string[][][]): ExtractedHealthFields {
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);

  // Lines that look like lab values: "Glucose  95  mg/dL" etc.
  const metricRe = /\d+\.?\d*\s*(mg|mmol|g|kg|bpm|%|iu|u\/l|umol|ng|pg|fl|mcg)/i;
  const lineMetrics = lines.filter((l) => metricRe.test(l));

  // Table-aware extraction: for each table, rows where column 1 has a number
  const tableMetrics: string[] = [];
  for (const table of tables) {
    for (const row of table) {
      if (row.length < 2) continue;
      const [name, value, unit] = row;
      if (!name || !value) continue;
      if (!/\d/.test(value)) continue; // value column must contain a number
      const metric = unit ? `${name}: ${value} ${unit}`.trim() : `${name}: ${value}`.trim();
      tableMetrics.push(metric);
    }
  }

  const possibleMetrics = [
    ...tableMetrics,
    ...lineMetrics.filter((l) => !tableMetrics.some((t) => t.includes(l.slice(0, 10)))),
  ];

  const dateRe = /\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b/;
  const dateHints = lines.filter((l) => dateRe.test(l));

  return {
    possibleMetrics,
    dateHints,
    summary: lines.slice(0, 12).join('\n'),
  };
}

function guessDocType(text: string): DocType {
  const lower = text.toLowerCase();
  if (/glucose|hemoglobin|cholesterol|creatinine|blood|lab|panel|hba1c|ldl|hdl/.test(lower)) return 'bloodTest';
  if (/steps|heart rate|vo2|fitness|workout|exercise|calories|resting/.test(lower)) return 'fitness';
  if (/prescription|dosage|mg|tablet|capsule|medication|pharmacy/.test(lower)) return 'medication';
  return 'general';
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.background },
  scroll: { flexGrow: 1, paddingHorizontal: layout.screenPaddingH, paddingTop: space[5], paddingBottom: space[8] },
  content: { width: '100%', maxWidth: layout.maxContentWidth, alignSelf: 'center' },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: space[1], marginBottom: space[5], alignSelf: 'flex-start', minHeight: 44 },
  backChevron: { fontSize: 22, color: color.accent },
  backLabel: { ...type.body, color: color.accent, fontWeight: '600' as const },
  h1: { ...type.h1, color: color.textPrimary },
  sub: { ...type.subtext, color: color.textSecondary, marginTop: space[3], lineHeight: 22 },
  cta: { marginTop: space[7] },
  savedNote: { ...type.caption, color: color.textSecondary, textAlign: 'center', marginTop: space[4] },
  center: { marginTop: space[8], alignItems: 'center' },
  dim: { ...type.subtext, color: color.textSecondary, textAlign: 'center' },
  glyphLarge: { fontSize: 48, color: color.accent, marginBottom: space[4] },
  savedTitle: { ...type.h2, color: color.textPrimary, marginBottom: space[3] },
  reviewWrap: { marginTop: space[6] },
  reviewHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: space[3], marginBottom: space[4] },
  reviewTitle: { ...type.h2, color: color.textPrimary, flex: 1 },
  engineBadge: {
    backgroundColor: color.accent,
    borderRadius: radii.pill,
    paddingHorizontal: space[3],
    paddingVertical: 3,
    alignSelf: 'flex-start',
    marginTop: 3,
  },
  engineBadgeText: { ...type.caption, color: color.onAccent, fontWeight: '600' as const },
  tableNote: { ...type.caption, color: color.textSecondary, marginBottom: space[4] },
  card: { backgroundColor: color.surface, borderRadius: radii.md, borderWidth: 1, borderColor: color.border, padding: space[4], marginBottom: space[5] },
  cardLabel: { ...type.captionStrong, color: color.textSecondary, marginBottom: space[2] },
  metric: { ...type.body, color: color.textPrimary, marginBottom: 2 },
  moreMetrics: { ...type.caption, color: color.textTertiary, marginTop: space[1] },
  typeLabel: { ...type.captionStrong, color: color.textSecondary, marginBottom: space[2], textTransform: 'uppercase', letterSpacing: 0.5 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginBottom: space[5] },
  chip: { paddingHorizontal: space[3], paddingVertical: space[2], borderRadius: radii.pill, borderWidth: 1, borderColor: color.border, backgroundColor: color.surface },
  chipOn: { backgroundColor: color.accent, borderColor: color.accent },
  chipText: { ...type.caption, color: color.textSecondary },
  chipTextOn: { color: color.onAccent, fontWeight: '600' as const },
  preview: { backgroundColor: color.surfaceAlt, borderRadius: radii.md, padding: space[4], marginBottom: space[5] },
  previewLabel: { ...type.captionStrong, color: color.textSecondary, marginBottom: space[2] },
  previewText: { ...type.caption, color: color.textSecondary, lineHeight: 18 },
  actions: { marginTop: space[2] },
});

export default HealthImportScreen;
