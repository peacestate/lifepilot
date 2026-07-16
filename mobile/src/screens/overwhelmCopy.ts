/**
 * Overwhelm Manager microcopy — English verbatim from design/overwhelm/screen-spec.md §4.
 * Single source so the screen stays declarative. Tone rules (§4): warm, plain,
 * second person; never "server/upload/cloud/internet" except to reassure.
 *
 * Hindi follows the same tone rules — simple, warm, spoken-register Hindi (Devanagari),
 * not formal shuddh Hindi; feature names stay in English (they're product names).
 */
import { localized } from '../core/i18n/i18n';

export const COPY = localized(
  {
    promptH1: "What's overwhelming you today?",
    subtext:
      "Type it out. I'll break it into small, doable steps — right here on your phone.",
    placeholder: 'e.g. "Plan my sister\'s birthday next weekend"',
    submitCta: 'Break it down',
    privacyFootnote: 'Runs fully on your device. Nothing is sent anywhere.',
    loadingTitle: 'Thinking this through on your device…',
    loadingOffline: 'Works in airplane mode. Your words never leave this phone.',
    // shown while the model is still loading/warming on first entry (integration §4.5)
    preparingTitle: 'Getting things ready, fully on your device.',
    taskChipLabel: 'You asked:',
    stopButton: 'Stop',
    allComplete: 'Nicely done. You handled it, one step at a time.',
    emptyResult:
      "I couldn't break that one down just now. Let's try again — or tweak the wording.",
    error: "Something hiccuped on this end. Your text is safe — let's try again.",
    retryButton: 'Try again',
    editButton: 'Edit',
    startOverButton: 'Start over',
    // "tap a step to go deeper" feature
    breakDownStepCta: 'Break this into smaller steps',
    breakingDownStep: 'Breaking this down on your device…',
    breakdownEmpty: "This one's already about as small as it gets.",
    breakdownError: "Couldn't split that one — try again.",
    // shown after the app restarts following a crash mid-generation (see RUNBOOK.md)
    recoveredDraftLabel: 'The app closed before finishing your last task:',
    recoveredDraftResume: 'Resume',
    recoveredDraftDismiss: 'Discard',
  },
  {
    promptH1: 'आज आपको क्या भारी लग रहा है?',
    subtext: 'लिख दीजिए। मैं इसे छोटे, आसान क़दमों में बाँट दूँगा — यहीं, आपके फ़ोन पर।',
    placeholder: 'जैसे "अगले हफ़्ते बहन का जन्मदिन प्लान करना"',
    submitCta: 'क़दमों में बाँटें',
    privacyFootnote: 'पूरी तरह आपके फ़ोन पर चलता है। कुछ भी कहीं नहीं भेजा जाता।',
    loadingTitle: 'आपके फ़ोन पर ही इस पर सोच रहा हूँ…',
    loadingOffline: 'एयरप्लेन मोड में भी चलता है। आपके शब्द इस फ़ोन से बाहर नहीं जाते।',
    preparingTitle: 'तैयारी हो रही है — पूरी तरह आपके फ़ोन पर।',
    taskChipLabel: 'आपने पूछा:',
    stopButton: 'रोकें',
    allComplete: 'बहुत बढ़िया। आपने इसे संभाल लिया — एक-एक क़दम करके।',
    emptyResult: 'इसे अभी बाँट नहीं पाया। फिर से कोशिश करें — या शब्द थोड़े बदलकर देखें।',
    error: 'इस तरफ़ कुछ अटक गया। आपका लिखा सुरक्षित है — चलिए, फिर से कोशिश करते हैं।',
    retryButton: 'फिर कोशिश करें',
    editButton: 'बदलें',
    startOverButton: 'नए सिरे से',
    breakDownStepCta: 'इसे और छोटे क़दमों में बाँटें',
    breakingDownStep: 'आपके फ़ोन पर ही बाँट रहा हूँ…',
    breakdownEmpty: 'यह क़दम पहले से ही काफ़ी छोटा है।',
    breakdownError: 'इसे बाँट नहीं पाया — फिर कोशिश करें।',
    recoveredDraftLabel: 'पिछला काम पूरा होने से पहले ऐप बंद हो गया था:',
    recoveredDraftResume: 'जारी रखें',
    recoveredDraftDismiss: 'हटा दें',
  },
);
