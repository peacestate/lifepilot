/**
 * healthImportUtils — shared PDF parsing helpers.
 *
 * extractPdfTextLayer  — synchronous BT/ET regex extractor (legacy, kept for compatibility)
 * parsePdfDocument     — async LiteParse wrapper; table-aware on iOS with Polygen
 *
 * Both pdfSource (expense) and HealthImportScreen import from here so there is
 * no circular dependency. liteparseService imports only from core/liteparse/,
 * not from this file.
 */
export { extractPdfTextLayer } from '../core/liteparse/regexExtractor';

export { parsePdf as parsePdfDocument, isLiteParseAvailable } from '../core/liteparse/liteparseService';
export type { LiteParseResult, ParsedPage } from '../core/liteparse/types';
