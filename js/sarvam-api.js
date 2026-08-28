/**
 * sarvam-api.js
 * Thin wrapper around Sarvam AI's REST API (translation + text-to-speech).
 * BYOK: the API key lives only in the browser and is sent directly to
 * Sarvam's servers — never to any server we control.
 */

const SARVAM_BASE_URL = 'https://api.sarvam.ai';

// Mayura:v1 caps input at 1000 characters per call.
const TRANSLATE_CHUNK_LIMIT = 950;
// bulbul:v3 caps input at 2500 characters per call.
const TTS_CHUNK_LIMIT = 2400;

class SarvamApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'SarvamApiError';
    this.status = status;
  }
}

/**
 * Split text into chunks no longer than maxLen, breaking on sentence or
 * whitespace boundaries where possible so words aren't cut mid-way.
 */
function chunkText(text, maxLen) {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLen) return clean.length ? [clean] : [];

  const chunks = [];
  let remaining = clean;
  while (remaining.length > maxLen) {
    let cut = remaining.lastIndexOf('. ', maxLen);
    if (cut < maxLen * 0.4) cut = remaining.lastIndexOf(' ', maxLen);
    if (cut < 0) cut = maxLen;
    chunks.push(remaining.slice(0, cut + 1).trim());
    remaining = remaining.slice(cut + 1).trim();
  }
  if (remaining.length) chunks.push(remaining);
  return chunks;
}

async function sarvamFetch(apiKey, path, body) {
  const res = await fetch(`${SARVAM_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'api-subscription-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let detail = '';
    try {
      const errJson = await res.json();
      detail = errJson?.error?.message || JSON.stringify(errJson);
    } catch {
      detail = await res.text();
    }
    if (res.status === 403 || res.status === 401) {
      throw new SarvamApiError('Your Sarvam API key was rejected. Double-check it and try again.', res.status);
    }
    if (res.status === 429) {
      throw new SarvamApiError('Sarvam API rate limit reached. Wait a moment and try again.', res.status);
    }
    throw new SarvamApiError(`Sarvam API error (${res.status}): ${detail}`, res.status);
  }

  return res.json();
}

/**
 * Translate text. Splits long text into API-safe chunks and rejoins the
 * translated result in order.
 * @returns {Promise<string>} translated text
 */
async function translateText(apiKey, text, targetLanguageCode, { onProgress } = {}) {
  const chunks = chunkText(text, TRANSLATE_CHUNK_LIMIT);
  const translated = [];
  for (let i = 0; i < chunks.length; i++) {
    if (onProgress) onProgress(i, chunks.length);
    const result = await sarvamFetch(apiKey, '/translate', {
      input: chunks[i],
      source_language_code: 'auto',
      target_language_code: targetLanguageCode,
      model: 'mayura:v1',
      mode: 'modern-colloquial',
    });
    translated.push(result.translated_text);
  }
  return translated.join(' ');
}

/**
 * Convert text to speech. Splits long text into API-safe chunks, requests
 * audio for each, and returns an array of base64 WAV strings in order
 * (concatenation into one file happens in audio-utils.js).
 * @returns {Promise<string[]>} array of base64-encoded WAV audio chunks
 */
async function textToSpeech(apiKey, text, targetLanguageCode, { onProgress } = {}) {
  const chunks = chunkText(text, TTS_CHUNK_LIMIT);
  const audioChunks = [];
  for (let i = 0; i < chunks.length; i++) {
    if (onProgress) onProgress(i, chunks.length);
    const result = await sarvamFetch(apiKey, '/text-to-speech', {
      text: chunks[i],
      target_language_code: targetLanguageCode,
      model: 'bulbul:v3',
      speaker: 'shubh',
      speech_sample_rate: 24000,
    });
    audioChunks.push(...result.audios);
  }
  return audioChunks;
}

/** Quick key validity check using a tiny translation call. */
async function verifyApiKey(apiKey) {
  await sarvamFetch(apiKey, '/translate', {
    input: 'Hello',
    source_language_code: 'en-IN',
    target_language_code: 'hi-IN',
    model: 'mayura:v1',
  });
  return true;
}

window.SarvamApi = { translateText, textToSpeech, verifyApiKey, SarvamApiError };
