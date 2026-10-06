import { EdgeTTS } from 'edge-tts-universal';

async function test() {
  try {
    const tts = new EdgeTTS('Hello, this is a test from Microsoft Edge TTS.', 'en-US-GuyNeural');
    const result = await tts.synthesize();
    const audioBuffer = Buffer.from(await result.audio.arrayBuffer());
    console.log(`Success! Received ${audioBuffer.length} bytes of audio.`);
  } catch (err) {
    console.error('Error:', err);
  }
}

test();
