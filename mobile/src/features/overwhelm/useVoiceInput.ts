/**
 * useVoiceInput — on-device voice input for the Overwhelm Manager's task box.
 *
 * Speak a task instead of typing it. Microphone capture (react-native-audio-api's
 * `AudioRecorder`) delivers raw Float32 PCM directly via `onAudioReady` — no
 * intermediate audio file, no WAV parsing. Transcription runs on-device through
 * react-native-executorch's `useSpeechToText` (Whisper tiny.en), loaded from
 * locally-provisioned model files (voiceModelProvisioner.ts) so no network call
 * is ever involved, matching the rest of the app's privacy guarantee.
 *
 * API ASSUMPTIONS — verified against react-native-audio-api@0.13.1 source
 * (AudioRecorder.ts, AudioManager.ts, AudioBuffer.ts) since the published docs
 * site didn't cover the recording API in enough depth to trust from memory:
 *   - `new AudioRecorder()` + `.onAudioReady({sampleRate, bufferLength,
 *     channelCount}, cb)` + `.start()` / `.stop()`. No `enableFileOutput()`
 *     call — we only want live buffers, never a file.
 *   - `event.buffer.getChannelData(0)` returns a `Float32Array` in [-1, 1],
 *     which is exactly what `transcribe(waveform: number[])` expects.
 *   - `AudioManager.requestRecordingPermissions()` for the mic permission
 *     prompt (separate from the Android manifest permission — both required).
 * ⚠️ ON-DEVICE VERIFY (mobile + CTO): this is the first use of
 * react-native-audio-api in this project — confirm `onAudioReady` actually
 * fires at the requested 16kHz/mono config on both Android and iOS, and that
 * `recorder.stop()` cleanly tears down without the native-crash-on-unmount
 * class of bug already seen with the LLM's interrupt() path.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioManager, AudioRecorder } from 'react-native-audio-api';
// eslint-disable-next-line import/no-unresolved -- added during native setup
import { useSpeechToText } from 'react-native-executorch';

import { provisionVoiceModel, type VoiceModelSources } from './voiceModelProvisioner';

const SAMPLE_RATE = 16000;
const BUFFER_LENGTH = 4096;

export type VoiceInputState = 'unavailable' | 'idle' | 'recording' | 'transcribing';

export type UseVoiceInput = {
  /** 'unavailable' (model not provisioned/loading) | 'idle' | 'recording' | 'transcribing' */
  state: VoiceInputState;
  error: Error | null;
  /** Start capturing microphone audio. No-op if not idle. */
  startRecording: () => Promise<void>;
  /** Stop capturing and transcribe what was recorded. Resolves with the text. */
  stopRecording: () => Promise<string>;
};

export function useVoiceInput(): UseVoiceInput {
  const [sources, setSources] = useState<VoiceModelSources | null>(null);
  const [provisionError, setProvisionError] = useState<Error | null>(null);
  const [state, setState] = useState<VoiceInputState>('unavailable');
  const [runtimeError, setRuntimeError] = useState<Error | null>(null);

  useEffect(() => {
    let alive = true;
    provisionVoiceModel()
      .then((s) => alive && setSources(s))
      .catch((e: unknown) => alive && setProvisionError(e instanceof Error ? e : new Error(String(e))));
    return () => {
      alive = false;
    };
  }, []);

  const stt = useSpeechToText({
    modelName: 'whisper',
    encoderSource: sources?.encoderSource,
    decoderSource: sources?.decoderSource,
    tokenizerSource: sources?.tokenizerSource,
    preventLoad: !sources,
  } as never);

  useEffect(() => {
    if (!stt.isReady) return;
    setState((prev) => (prev === 'unavailable' ? 'idle' : prev));
  }, [stt.isReady]);

  const recorderRef = useRef<AudioRecorder | null>(null);
  const samplesRef = useRef<number[]>([]);

  const startRecording = useCallback(async () => {
    if (state !== 'idle') return;
    setRuntimeError(null);

    const perm = await AudioManager.requestRecordingPermissions();
    if (perm !== 'Granted') {
      setRuntimeError(new Error('Microphone permission denied.'));
      return;
    }

    const recorder = new AudioRecorder();
    recorderRef.current = recorder;
    samplesRef.current = [];

    recorder.onAudioReady(
      { sampleRate: SAMPLE_RATE, bufferLength: BUFFER_LENGTH, channelCount: 1 },
      (event) => {
        const chunk = event.buffer.getChannelData(0);
        // Float32Array -> plain array, appended in place (avoids a spread on
        // a large typed array on every buffer callback).
        for (let i = 0; i < chunk.length; i++) samplesRef.current.push(chunk[i]!);
      },
    );
    recorder.onError((e) => setRuntimeError(new Error(e.message)));

    try {
      await recorder.start();
      setState('recording');
    } catch (e) {
      setRuntimeError(e instanceof Error ? e : new Error(String(e)));
      recorderRef.current = null;
    }
  }, [state]);

  const stopRecording = useCallback(async (): Promise<string> => {
    if (state !== 'recording' || !recorderRef.current) return '';
    try {
      await recorderRef.current.stop();
    } catch (e) {
      setRuntimeError(e instanceof Error ? e : new Error(String(e)));
    }
    recorderRef.current.clearOnAudioReady();
    recorderRef.current = null;

    const waveform = samplesRef.current;
    samplesRef.current = [];

    if (waveform.length === 0) {
      setState('idle');
      return '';
    }

    setState('transcribing');
    try {
      const text = await stt.transcribe(waveform);
      setState('idle');
      return text;
    } catch (e) {
      setRuntimeError(e instanceof Error ? e : new Error(String(e)));
      setState('idle');
      return '';
    }
  }, [state, stt]);

  // Stop cleanly if the screen unmounts mid-recording.
  useEffect(
    () => () => {
      recorderRef.current?.stop().catch(() => {
        /* no-op */
      });
    },
    [],
  );

  return {
    state: provisionError || stt.error ? 'unavailable' : state,
    error: provisionError ?? stt.error ?? runtimeError,
    startRecording,
    stopRecording,
  };
}
