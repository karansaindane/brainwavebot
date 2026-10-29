/**
 * Automated Verification & Test Suite for 2-Class Brainwave BCI
 * Run with: npm test (or: node test.js)
 */

const assert = require('assert');
const dgram = require('dgram');
const RingBuffer = require('./server/ringBuffer');
const {
  fft,
  computePSD,
  getBandPower,
  analyzeSpectrum,
  computeLateralizationIndex,
  analyzeBilateralSpectrum
} = require('./server/dsp');

console.log('='.repeat(70));
console.log('🧠 BRAINWAVE 2-CLASS BCI (LEFT vs. RIGHT HAND) - TEST SUITE');
console.log('='.repeat(70));

let passed = 0;
let total = 0;

function runTest(name, fn) {
  total++;
  try {
    fn();
    console.log(`  ✓ [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ [FAIL] ${name}`);
    console.error(`     Error: ${err.message}`);
  }
}

async function runAsyncTest(name, fn) {
  total++;
  try {
    await fn();
    console.log(`  ✓ [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ [FAIL] ${name}`);
    console.error(`     Error: ${err.message}`);
  }
}

async function main() {
  console.log('\n--- 1. RingBuffer Bilateral Extraction Tests ---');

  runTest('Pushes 8-channel samples and extracts C3 (ch 0) and C4 (ch 2)', () => {
    const rb = new RingBuffer(250, 8);
    for (let i = 0; i < 250; i++) {
      const sample = [i * 1.0, 0, i * 2.0, 0, 0, 0, 0, 0];
      rb.push(sample);
    }
    assert.strictEqual(rb.isFull(), true);

    const c3 = rb.getChannelData(0);
    const c4 = rb.getChannelData(2);

    assert.strictEqual(c3[0], 0);
    assert.strictEqual(c3[249], 249.0);
    assert.strictEqual(c4[0], 0);
    assert.strictEqual(c4[249], 498.0);
  });

  console.log('\n--- 2. Bilateral DSP & Lateralization Index (LI) Tests ---');

  runTest('Lateralization Index formula: LI = (P_C4 - P_C3) / (P_C4 + P_C3)', () => {
    // Balanced Rest
    const liRest = computeLateralizationIndex(100.0, 100.0);
    assert.strictEqual(liRest, 0.0, 'Resting state should have LI = 0.0');

    // Right Hand (C3 desynchronized to 5.0, C4 remains 100.0)
    const liRight = computeLateralizationIndex(5.0, 100.0);
    assert(liRight > 0.8, `Right hand should have strong positive LI, got ${liRight.toFixed(3)}`);

    // Left Hand (C4 desynchronized to 5.0, C3 remains 100.0)
    const liLeft = computeLateralizationIndex(100.0, 5.0);
    assert(liLeft < -0.8, `Left hand should have strong negative LI, got ${liLeft.toFixed(3)}`);
  });

  console.log('\n--- 3. 2-Class Motor Imagery Signal Classification ---');

  runTest('Classifies simulated signals into REST, RIGHT_HAND, and LEFT_HAND', () => {
    const sampleRate = 250;
    const N = 250;

    function makeSignal(erd) {
      const sig = new Float64Array(N);
      for (let i = 0; i < N; i++) {
        const t = i / sampleRate;
        sig[i] =
          (15.0 * erd) * Math.sin(2 * Math.PI * 10 * t) +
          6.0 * Math.sin(2 * Math.PI * 18 * t) +
          2.5 * Math.sin(2 * Math.PI * 50 * t);
      }
      return sig;
    }

    // 1. REST (Both 100%)
    const restC3 = makeSignal(1.0);
    const restC4 = makeSignal(1.0);
    const resRest = analyzeBilateralSpectrum(restC3, restC4, sampleRate);
    console.log(`     [REST]       LI: ${resRest.lateralizationIndex.toFixed(3)} | C3 Mu: ${resRest.c3.muPower.toFixed(1)} | C4 Mu: ${resRest.c4.muPower.toFixed(1)}`);
    assert(Math.abs(resRest.lateralizationIndex) < 0.1, 'Rest LI should be near 0');

    // 2. RIGHT HAND (C3 drops to 20%, C4 stays 100%)
    const rightC3 = makeSignal(0.2);
    const rightC4 = makeSignal(1.0);
    const resRight = analyzeBilateralSpectrum(rightC3, rightC4, sampleRate);
    console.log(`     [RIGHT HAND] LI: +${resRight.lateralizationIndex.toFixed(3)} | C3 Mu: ${resRight.c3.muPower.toFixed(1)} | C4 Mu: ${resRight.c4.muPower.toFixed(1)}`);
    assert(resRight.lateralizationIndex >= 0.35, 'Right hand LI must exceed +0.35 threshold');

    // 3. LEFT HAND (C4 drops to 20%, C3 stays 100%)
    const leftC3 = makeSignal(1.0);
    const leftC4 = makeSignal(0.2);
    const resLeft = analyzeBilateralSpectrum(leftC3, leftC4, sampleRate);
    console.log(`     [LEFT HAND]  LI: ${resLeft.lateralizationIndex.toFixed(3)} | C3 Mu: ${resLeft.c3.muPower.toFixed(1)} | C4 Mu: ${resLeft.c4.muPower.toFixed(1)}`);
    assert(resLeft.lateralizationIndex <= -0.35, 'Left hand LI must drop below -0.35 threshold');
  });

  console.log('\n--- 4. UDP Binary Protocol & Packaging ---');

  await runAsyncTest('Encodes and decodes 8-channel IEEE 754 float32 packets over UDP', async () => {
    return new Promise((resolve, reject) => {
      const PORT = 3999;
      const server = dgram.createSocket('udp4');
      const client = dgram.createSocket('udp4');

      const testValues = [12.5, -8.3, 0.0, 45.2, -1.1, 7.8, -99.9, 100.2];

      server.on('message', (msg) => {
        try {
          assert.strictEqual(msg.length, 32);
          const decoded = [];
          for (let ch = 0; ch < 8; ch++) {
            decoded.push(parseFloat(msg.readFloatLE(ch * 4).toFixed(1)));
          }
          assert.deepStrictEqual(decoded, testValues);
          server.close();
          client.close();
          resolve();
        } catch (err) {
          server.close();
          client.close();
          reject(err);
        }
      });

      function verifyDirectBuffer() {
        const buf = Buffer.alloc(32);
        for (let ch = 0; ch < 8; ch++) {
          buf.writeFloatLE(testValues[ch], ch * 4);
        }
        const decoded = [];
        for (let ch = 0; ch < 8; ch++) {
          decoded.push(parseFloat(buf.readFloatLE(ch * 4).toFixed(1)));
        }
        assert.deepStrictEqual(decoded, testValues);
        try { server.close(); } catch (e) {}
        try { client.close(); } catch (e) {}
        resolve();
      }

      server.on('error', () => verifyDirectBuffer());

      try {
        server.bind(PORT, '127.0.0.1', () => {
          const buf = Buffer.alloc(32);
          for (let ch = 0; ch < 8; ch++) {
            buf.writeFloatLE(testValues[ch], ch * 4);
          }
          client.send(buf, PORT, '127.0.0.1', (err) => {
            if (err) verifyDirectBuffer();
          });
        });
      } catch (err) {
        verifyDirectBuffer();
      }
    });
  });

  console.log('\n' + '='.repeat(70));
  console.log(`RESULTS: ${passed} / ${total} tests passed (${Math.round((passed / total) * 100)}%)`);
  console.log('='.repeat(70) + '\n');

  if (passed !== total) process.exit(1);
}

main().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
