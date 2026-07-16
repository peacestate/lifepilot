/**
 * OnboardingScreen — 3 steps shown once on first launch.
 *   0  Welcome   — app name + tagline
 *   1  Privacy   — on-device AI explanation
 *   2  Nudges    — notification permission request (skippable)
 *
 * On completion (or skip at step 2) calls props.onDone().
 */
import * as Notifications from 'expo-notifications';
import React, { useState } from 'react';
import {
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { PrimaryButton } from '../components/PrimaryButton';
import { SecondaryButton } from '../components/SecondaryButton';
import { getLocale, localized, type Locale } from '../core/i18n/i18n';
import { color, layout, radii, space, type } from '../theme/tokens';

type Props = { onDone: () => void };

type Step = { glyph: string; title: string; body: string; cta: string };

const STEPS_EN: Step[] = [
  {
    glyph: '◉',
    title: 'For when starting is the hardest part',
    body: 'A task that feels too big to begin. A day that got away from you.\nTell LifePilot what’s overwhelming you and it breaks it into small, doable steps — and quietly watches your energy, water, and spending too.',
    cta: 'Get started',
  },
  {
    glyph: '◎',
    title: 'What overwhelms you is nobody’s business',
    body: 'The AI itself lives on your phone, so nothing you type or track ever leaves it.\nNo account, no cloud, no one reading over your shoulder — not even us. Everything works in airplane mode.',
    cta: 'Got it',
  },
  {
    glyph: '◐',
    title: 'A quiet tap on the shoulder',
    body: 'Out of sight slips out of mind — that’s not a flaw, it’s how busy brains work.\nLifePilot can gently resurface the next step, a sip of water, or your best focus window. Never pushy, and you can change it any time in Settings.',
    cta: 'Turn on nudges',
  },
];

// Same glyphs everywhere; only title/body/cta localize. Any locale without a steps
// array falls back to English wholesale (steps read as a unit, unlike localized()'s
// per-key fallback — a mixed-language onboarding step would read worse than English).
const STEPS_BY_LOCALE: Partial<Record<Locale, Step[]>> = {
  es: [
    {
      glyph: '◉',
      title: 'Para cuando empezar es lo más difícil',
      body: 'Una tarea que se siente demasiado grande para empezar. Un día que se te fue de las manos.\nCuéntale a LifePilot qué te abruma y lo dividirá en pasos pequeños y manejables — y además cuida en silencio tu energía, tu agua y tus gastos.',
      cta: 'Comenzar',
    },
    {
      glyph: '◎',
      title: 'Lo que te abruma no le importa a nadie más',
      body: 'La IA vive en tu teléfono, así que nada de lo que escribes o registras sale de él.\nSin cuenta, sin nube, sin nadie mirando por encima de tu hombro — ni siquiera nosotros. Todo funciona en modo avión.',
      cta: 'Entendido',
    },
    {
      glyph: '◐',
      title: 'Un toque suave en el hombro',
      body: 'Lo que no se ve, se olvida — no es un defecto, así funcionan las mentes ocupadas.\nLifePilot puede recordarte con suavidad el siguiente paso, un sorbo de agua o tu mejor momento de concentración. Nunca insistente, y puedes cambiarlo cuando quieras en Ajustes.',
      cta: 'Activar recordatorios',
    },
  ],
  fr: [
    {
      glyph: '◉',
      title: 'Pour quand commencer est le plus dur',
      body: 'Une tâche trop grosse pour s’y mettre. Une journée qui vous a échappé.\nDites à LifePilot ce qui vous submerge : il le découpe en petites étapes faisables — et veille aussi, discrètement, sur votre énergie, votre hydratation et vos dépenses.',
      cta: 'Commencer',
    },
    {
      glyph: '◎',
      title: 'Ce qui vous submerge ne regarde personne',
      body: 'L’IA vit sur votre téléphone : rien de ce que vous écrivez ou suivez n’en sort jamais.\nPas de compte, pas de cloud, personne qui lit par-dessus votre épaule — pas même nous. Tout fonctionne en mode avion.',
      cta: 'Compris',
    },
    {
      glyph: '◐',
      title: 'Une petite tape sur l’épaule',
      body: 'Loin des yeux, loin de l’esprit — ce n’est pas un défaut, c’est ainsi que fonctionnent les esprits occupés.\nLifePilot peut vous rappeler en douceur la prochaine étape, une gorgée d’eau ou votre meilleur créneau de concentration. Jamais insistant, et modifiable à tout moment dans les Réglages.',
      cta: 'Activer les rappels',
    },
  ],
  de: [
    {
      glyph: '◉',
      title: 'Für die Momente, in denen Anfangen am schwersten ist',
      body: 'Eine Aufgabe, die zu groß wirkt, um anzufangen. Ein Tag, der dir entglitten ist.\nSag LifePilot, was dich überfordert — es zerlegt es in kleine, machbare Schritte und behält nebenbei still deine Energie, dein Wasser und deine Ausgaben im Blick.',
      cta: 'Los geht’s',
    },
    {
      glyph: '◎',
      title: 'Was dich überfordert, geht niemanden etwas an',
      body: 'Die KI selbst lebt auf deinem Handy — nichts, was du tippst oder trackst, verlässt es je.\nKein Konto, keine Cloud, niemand, der mitliest — nicht einmal wir. Alles funktioniert im Flugmodus.',
      cta: 'Verstanden',
    },
    {
      glyph: '◐',
      title: 'Ein leises Tippen auf die Schulter',
      body: 'Aus den Augen, aus dem Sinn — kein Makel, so arbeiten beschäftigte Köpfe.\nLifePilot kann dich sanft an den nächsten Schritt, einen Schluck Wasser oder dein bestes Fokusfenster erinnern. Nie aufdringlich — und jederzeit in den Einstellungen änderbar.',
      cta: 'Erinnerungen aktivieren',
    },
  ],
  it: [
    {
      glyph: '◉',
      title: 'Per quando iniziare è la parte più difficile',
      body: 'Un compito che sembra troppo grande per cominciare. Una giornata sfuggita di mano.\nRacconta a LifePilot cosa ti sopraffà: lo dividerà in piccoli passi fattibili — e terrà d’occhio in silenzio anche energia, acqua e spese.',
      cta: 'Inizia',
    },
    {
      glyph: '◎',
      title: 'Ciò che ti sopraffà non riguarda nessun altro',
      body: 'L’IA vive sul tuo telefono, quindi nulla di ciò che scrivi o registri lo lascia mai.\nNessun account, nessun cloud, nessuno che legge alle tue spalle — nemmeno noi. Tutto funziona in modalità aereo.',
      cta: 'Capito',
    },
    {
      glyph: '◐',
      title: 'Un tocco leggero sulla spalla',
      body: 'Lontano dagli occhi, lontano dalla mente — non è un difetto, è così che lavorano le menti impegnate.\nLifePilot può ricordarti con delicatezza il prossimo passo, un sorso d’acqua o la tua migliore finestra di concentrazione. Mai invadente, e puoi cambiarlo quando vuoi nelle Impostazioni.',
      cta: 'Attiva i promemoria',
    },
  ],
  pt: [
    {
      glyph: '◉',
      title: 'Para quando começar é a parte mais difícil',
      body: 'Uma tarefa grande demais para começar. Um dia que escapou do controle.\nConte ao LifePilot o que está te sobrecarregando e ele divide em passos pequenos e possíveis — enquanto acompanha em silêncio sua energia, sua água e seus gastos.',
      cta: 'Começar',
    },
    {
      glyph: '◎',
      title: 'O que te sobrecarrega não é da conta de ninguém',
      body: 'A IA vive no seu telefone, então nada do que você escreve ou registra sai dele.\nSem conta, sem nuvem, ninguém espiando por cima do seu ombro — nem mesmo nós. Tudo funciona em modo avião.',
      cta: 'Entendi',
    },
    {
      glyph: '◐',
      title: 'Um toque leve no ombro',
      body: 'O que sai da vista sai da mente — não é um defeito, é como mentes ocupadas funcionam.\nO LifePilot pode lembrar com delicadeza o próximo passo, um gole de água ou sua melhor janela de foco. Nunca insistente — e você muda quando quiser nas Configurações.',
      cta: 'Ativar lembretes',
    },
  ],
  hi: [
    {
      glyph: '◉',
      title: 'जब शुरुआत ही सबसे मुश्किल हो',
      body: 'कोई काम इतना बड़ा लगे कि शुरू ही न हो पाए। कोई दिन हाथ से निकल जाए।\nLifePilot को बताइए क्या भारी लग रहा है — वह उसे छोटे, आसान क़दमों में बाँट देगा। साथ ही आपकी ऊर्जा, पानी और ख़र्च पर भी चुपचाप नज़र रखेगा।',
      cta: 'शुरू करें',
    },
    {
      glyph: '◎',
      title: 'जो आपको भारी लगता है, वह सिर्फ़ आपका है',
      body: 'AI ख़ुद आपके फ़ोन पर रहता है, इसलिए आपका लिखा या ट्रैक किया कुछ भी फ़ोन से बाहर नहीं जाता।\nन कोई अकाउंट, न कोई क्लाउड, न कोई झाँकने वाला — हम भी नहीं। सब कुछ एयरप्लेन मोड में भी चलता है।',
      cta: 'ठीक है',
    },
    {
      glyph: '◐',
      title: 'कंधे पर एक हल्की-सी थपकी',
      body: 'जो नज़र से हटा, वह दिमाग़ से भी हट जाता है — यह कोई कमी नहीं, व्यस्त दिमाग़ों का तरीक़ा है।\nLifePilot अगला क़दम, पानी का घूँट या आपका बेहतरीन फ़ोकस समय धीरे-से याद दिला सकता है। कभी ज़बरदस्ती नहीं — Settings में कभी भी बदल सकते हैं।',
      cta: 'रिमाइंडर चालू करें',
    },
  ],
};

const ONBOARDING_COPY = localized(
  { skip: 'Skip for now', footnote: '◉ Everything runs on-device — always.' },
  {
    es: { skip: 'Ahora no', footnote: '◉ Todo funciona en tu dispositivo — siempre.' },
    fr: { skip: 'Plus tard', footnote: '◉ Tout fonctionne sur l’appareil — toujours.' },
    de: { skip: 'Jetzt nicht', footnote: '◉ Alles läuft auf dem Gerät — immer.' },
    it: { skip: 'Non ora', footnote: '◉ Tutto funziona sul dispositivo — sempre.' },
    pt: { skip: 'Agora não', footnote: '◉ Tudo roda no aparelho — sempre.' },
    hi: { skip: 'अभी नहीं', footnote: '◉ सब कुछ आपके फ़ोन पर चलता है — हमेशा।' },
  },
);

export function OnboardingScreen({ onDone }: Props) {
  const [step, setStep] = useState(0);
  const STEPS = STEPS_BY_LOCALE[getLocale()] ?? STEPS_EN;

  const advance = async () => {
    if (step === STEPS.length - 1) {
      // request notification permission before finishing
      try { await Notifications.requestPermissionsAsync(); } catch { /* skip if unavailable */ }
      onDone();
      return;
    }
    setStep((s) => s + 1);
  };

  const skip = () => onDone();

  const { glyph, title, body, cta } = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.content}>
        {/* progress dots */}
        <View style={styles.dots} accessibilityLabel={`Step ${step + 1} of ${STEPS.length}`}>
          {STEPS.map((_, i) => (
            <View key={i} style={[styles.dot, i === step && styles.dotActive]} />
          ))}
        </View>

        {/* body */}
        <View style={styles.body}>
          <Text style={styles.glyph} aria-hidden>{glyph}</Text>
          <Text style={styles.title} accessibilityRole="header" maxFontSizeMultiplier={1.6}>
            {title}
          </Text>
          <Text style={styles.bodyText} maxFontSizeMultiplier={1.6}>{body}</Text>
        </View>

        {/* actions */}
        <View style={styles.actions}>
          <PrimaryButton label={cta} onPress={advance} />
          {isLast && (
            <View style={styles.skipRow}>
              <SecondaryButton label={ONBOARDING_COPY.skip} onPress={skip} />
            </View>
          )}
        </View>

        {/* privacy reassurance */}
        <Text style={styles.footnote} maxFontSizeMultiplier={1.4}>
          {ONBOARDING_COPY.footnote}
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.background },
  content: {
    flex: 1,
    paddingHorizontal: layout.screenPaddingH,
    paddingTop: space[7],
    paddingBottom: space[6],
    maxWidth: layout.maxContentWidth,
    alignSelf: 'center',
    width: '100%',
  },
  dots: { flexDirection: 'row', gap: space[2], marginBottom: space[8] },
  dot: {
    width: 6,
    height: 6,
    borderRadius: radii.pill,
    backgroundColor: color.surfaceAlt,
  },
  dotActive: { backgroundColor: color.accent, width: 18 },
  body: { flex: 1, justifyContent: 'center' },
  glyph: { fontSize: 48, color: color.accent, marginBottom: space[5] },
  title: {
    ...type.h1,
    color: color.textPrimary,
    marginBottom: space[4],
  },
  bodyText: {
    ...type.subtext,
    color: color.textSecondary,
    lineHeight: 24,
  },
  actions: { gap: space[3] },
  skipRow: { alignItems: 'center' },
  footnote: {
    ...type.caption,
    color: color.textTertiary,
    textAlign: 'center',
    marginTop: space[5],
  },
});

export default OnboardingScreen;
