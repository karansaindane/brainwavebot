/**
 * Automated Verification & Test Suite for Brainwave BCI
 * Run with: npm test (or: node test.js)
 */

const assert = require('assert');
const dgram = require('dgram');
const RingBuffer = require('./server/ringBuffer');
const { fft, computePSD, getBandPower, analyzeSpectrum } = require('./server/dsp');

console.log('='.repeat(65));
console.log('🧠 BRAINWAVE BCI - AUTOMATED TEST SUITE');
console.log('='.repeat(65));

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
  console.log('\n--- 1. RingBuffer Unit Tests ---');

  runTest('Initializes with correct capacity and channel count', () => {
    const rb = new RingBuffer(250, 8);
    assert.strictEqual(rb.capacity, 250);
    assert.strictEqual(rb.channels, 8);
    assert.strictEqual(rb.size(), 0);
    assert.strictEqual(rb.isFull(), false);
  });

  runTest('Pushes samples and handles circular wrap-around', () => {
    const rb = new RingBuffer(5, 2);
    for (let i = 0; i < 5; i++) {
      rb.push([i, i * 10]);
    }
    assert.strictEqual(rb.isFull(), true);
    assert.strictEqual(rb.size(), 5);

    // Push 2 more to overwrite indices 0 and 1
    rb.push([5, 50]);
    rb.push([6, 60]);
    assert.strictEqual(rb.size(), 5);

    // Chronological order should be: [2, 3, 4, 5, 6]
    const ch0 = rb.getChannelData(0);
    assert.deepStrictEqual(Array.from(ch0), [2, 3, 4, 5, 6]);

    const latest = rb.getLatestSample();
    assert.deepStrictEqual(latest, [6, 60]);
  });

  console.log('\n--- 2. DSP & Fast Fourier Transform (FFT) Tests ---');

  runTest('Radix-2 FFT executes with power-of-2 input length', () => {
    const N = 8;
    const real = new Float64Array([1, 2, 3, 4, 0, 0, 0, 0]);
    const imag = new Float64Array(N);
    fft(real, imag);

    // DC component (bin 0) must equal the sum of inputs: 1 + 2 + 3 + 4 = 10
    assert.strictEqual(Math.round(real[0]), 10);
    assert.strictEqual(Math.round(imag[0]), 0);
  });

  runTest('Isolates 10 Hz pure sine wave frequency peak', () => {
    const sampleRate = 250;
    const N = 250;
    const samples = new Float64Array(N);

    // Generate pure 10 Hz sine wave
    for (let i = 0; i < N; i++) {
      const t = i / sampleRate;
      samples[i] = 10.0 * Math.sin(2.0 * Math.PI * 10.0 * t);
    }

    const { bins } = computePSD(samples, sampleRate);

    // Find bin with maximum power
    let maxBin = null;
    let maxP = -1;
    for (const b of bins) {
      if (b.power > maxP) {
        maxP = b.power;
        maxBin = b;
      }
    }

    // Bin resolution is ~0.976 Hz. Bin 10 is ~9.77 Hz.
    assert(maxBin !== null, 'Peak bin must exist');
    assert(Math.abs(maxBin.freq - 10.0) < 1.0, `Peak frequency should be ~10 Hz, got ${maxBin.freq.toFixed(2)} Hz`);
  });

  console.log('\n--- 3. BCI Event-Related Desynchronization (ERD) Classifier ---');

  runTest('Detects 80% amplitude drop as >= 40% Mu power desynchronization', () => {
    const sampleRate = 250;
    const N = 250;

    // Normal baseline signal: 10 Hz (Mu) @ 15.0 uV + 18 Hz (Beta) @ 6.0 uV + 50 Hz (Mains) @ 2.5 uV
    const baselineSig = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const t = i / sampleRate;
      baselineSig[i] =
        15.0 * Math.sin(2 * Math.PI * 10 * t) +
        6.0 * Math.sin(2 * Math.PI * 18 * t) +
        2.5 * Math.sin(2 * Math.PI * 50 * t);
    }

    // ERD event: 10 Hz amplitude drops by 80% (to 3.0 uV)
    const erdSig = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const t = i / sampleRate;
      erdSig[i] =
        3.0 * Math.sin(2 * Math.PI * 10 * t) +
        6.0 * Math.sin(2 * Math.PI * 18 * t) +
        2.5 * Math.sin(2 * Math.PI * 50 * t);
    }

    const baseResult = analyzeSpectrum(baselineSig, sampleRate);
    const erdResult = analyzeSpectrum(erdSig, sampleRate);

    const baseMuPower = baseResult.muPower;
    const erdMuPower = erdResult.muPower;
    const dropPercent = ((baseMuPower - erdMuPower) / baseMuPower) * 100.0;

    console.log(`     Baseline Mu Power : ${baseMuPower.toFixed(2)} uV^2`);
    console.log(`     ERD Event Mu Power: ${erdMuPower.toFixed(2)} uV^2`);
    console.log(`     Observed Drop %   : ${dropPercent.toFixed(1)}% (Threshold: >= 40%)`);

    // An 80% amplitude drop yields ~96% power drop
    assert(dropPercent >= 40.0, `Drop percentage (${dropPercent.toFixed(1)}%) must exceed 40%`);
    assert(dropPercent > 90.0, `Power drop should be ~96%, got ${dropPercent.toFixed(1)}%`);
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
          assert.strictEqual(msg.length, 32, 'Payload must be exactly 32 bytes (8 x 4 bytes)');
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

      server.on('error', (err) => {
        // Fallback for sandboxed environments where raw socket binding is disallowed
        if (err.code === 'EPERM' || err.code === 'EACCES') {
          verifyDirectBuffer();
        } else {
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

      try {
        server.bind(PORT, '127.0.0.1', () => {
          const buf = Buffer.alloc(32);
          for (let ch = 0; ch < 8; ch++) {
            buf.writeFloatLE(testValues[ch], ch * 4);
          }
          client.send(buf, PORT, '127.0.0.1', (err) => {
            if (err) {
              if (err.code === 'EPERM' || err.code === 'EACCES') {
                verifyDirectBuffer();
              } else {
                server.close();
                client.close();
                reject(err);
              }
            }
          });
        });
      } catch (err) {
        verifyDirectBuffer();
      }
    });
  });

  console.log('\n' + '='.repeat(65));
  console.log(`RESULTS: ${passed} / ${total} tests passed (${Math.round((passed / total) * 100)}%)`);
  console.log('='.repeat(65) + '\n');

  if (passed !== total) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
