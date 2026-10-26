import { getRetell } from "./retell-client";
import { unwrapList } from "./retell-client";

/**
 * Voice management: import an existing ElevenLabs voice by ID, or clone one
 * from uploaded audio.
 *
 * Retell does the actual cloning — nothing here talks to ElevenLabs directly.
 * That means no ElevenLabs API key is needed for the "paste a voice ID" path,
 * and the audio-upload path works the same way regardless of which of
 * Retell's five providers a client prefers.
 */

export type ImportVoiceInput = {
  providerVoiceId: string;
  voiceName: string;
  publicUserId?: string;
};

/**
 * Add a voice you already own in ElevenLabs (or one of Retell's other
 * providers) by its voice ID. This is the path for "I already cloned my
 * voice in ElevenLabs — just point Retell at it."
 */
export async function importVoiceById(input: ImportVoiceInput) {
  const retell = getRetell();
  return retell.voice.addResource({
    provider_voice_id: input.providerVoiceId,
    voice_name: input.voiceName,
    public_user_id: input.publicUserId || undefined,
    voice_provider: "elevenlabs",
  });
}

export type CloneVoiceInput = {
  voiceName: string;
  files: { name: string; type: string; data: Buffer }[];
};

/**
 * Clone a voice directly from uploaded audio — the "I have a recording,
 * clone it for me" path. No ElevenLabs account needed; Retell handles the
 * whole pipeline.
 *
 * ElevenLabs Instant Voice Cloning wants at least a minute of clean audio,
 * more for a stronger clone. The SDK accepts up to 25 files.
 */
export async function cloneVoiceFromAudio(input: CloneVoiceInput) {
  const retell = getRetell();

  const files = input.files.map(
    (f) => new File([new Uint8Array(f.data)], f.name, { type: f.type })
  );

  return retell.voice.clone({
    files,
    voice_name: input.voiceName,
    voice_provider: "elevenlabs",
  });
}

export async function searchElevenLabsVoices(query: string) {
  const retell = getRetell();
  const res = await retell.voice.search({ search_query: query, voice_provider: "elevenlabs" });
  return unwrapList<unknown>(res);
}
