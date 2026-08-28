/**
 * audio-utils.js
 * Decodes base64 WAV chunks returned by the TTS API and stitches them
 * into a single playable/downloadable WAV file.
 */

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Parse a WAV file's header to find its format and the raw PCM data region. */
function parseWav(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12; // skip "RIFF"<size>"WAVE"
  let fmt = null;
  let dataOffset = -1;
  let dataLength = 0;

  while (offset < bytes.length - 8) {
    const chunkId = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
    const chunkSize = view.getUint32(offset + 4, true);
    const chunkDataStart = offset + 8;

    if (chunkId === 'fmt ') {
      fmt = {
        audioFormat: view.getUint16(chunkDataStart, true),
        numChannels: view.getUint16(chunkDataStart + 2, true),
        sampleRate: view.getUint32(chunkDataStart + 4, true),
        bitsPerSample: view.getUint16(chunkDataStart + 14, true),
      };
    } else if (chunkId === 'data') {
      dataOffset = chunkDataStart;
      dataLength = chunkSize;
    }
    offset = chunkDataStart + chunkSize + (chunkSize % 2);
  }

  return { fmt, dataOffset, dataLength };
}

function buildWavHeader(dataLength, fmt) {
  const buffer = new ArrayBuffer(44);
  const view = new DataView(buffer);
  const writeStr = (off, str) => { for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i)); };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, fmt.audioFormat, true);
  view.setUint16(22, fmt.numChannels, true);
  view.setUint32(24, fmt.sampleRate, true);
  view.setUint32(28, fmt.sampleRate * fmt.numChannels * (fmt.bitsPerSample / 8), true);
  view.setUint16(32, fmt.numChannels * (fmt.bitsPerSample / 8), true);
  view.setUint16(34, fmt.bitsPerSample, true);
  writeStr(36, 'data');
  view.setUint32(40, dataLength, true);

  return new Uint8Array(buffer);
}

/**
 * Concatenate an ordered array of base64 WAV strings (same format) into
 * a single WAV Blob.
 */
function concatenateWavChunks(base64Chunks) {
  if (!base64Chunks.length) return null;

  const parsed = base64Chunks.map(b64 => {
    const bytes = base64ToBytes(b64);
    return { bytes, ...parseWav(bytes) };
  });

  const fmt = parsed[0].fmt;
  const totalDataLength = parsed.reduce((sum, p) => sum + p.dataLength, 0);
  const header = buildWavHeader(totalDataLength, fmt);

  const out = new Uint8Array(44 + totalDataLength);
  out.set(header, 0);
  let pos = 44;
  for (const p of parsed) {
    out.set(p.bytes.subarray(p.dataOffset, p.dataOffset + p.dataLength), pos);
    pos += p.dataLength;
  }

  return new Blob([out], { type: 'audio/wav' });
}

window.AudioUtils = { concatenateWavChunks, base64ToBytes };
