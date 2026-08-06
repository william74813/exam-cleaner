import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aspectRatioDifference,
  resolutionRatio,
  analyzeRgbaPair,
  assessIntegrity
} from '../preview/v2.2/integrity.js';

function blank(width, height, value = 255) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = value;
    data[offset + 1] = value;
    data[offset + 2] = value;
    data[offset + 3] = 255;
  }
  return data;
}

function drawLine(data, width, x0, y0, x1, y1, value = 0) {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let step = 0; step <= steps; step++) {
    const x = Math.round(x0 + (x1 - x0) * step / Math.max(1, steps));
    const y = Math.round(y0 + (y1 - y0) * step / Math.max(1, steps));
    const offset = (y * width + x) * 4;
    data[offset] = value;
    data[offset + 1] = value;
    data[offset + 2] = value;
  }
}

test('identical images are low risk', () => {
  const width = 80, height = 100;
  const before = blank(width, height);
  drawLine(before, width, 8, 20, 72, 20);
  drawLine(before, width, 8, 45, 72, 45);
  const after = new Uint8ClampedArray(before);

  const pair = analyzeRgbaPair(before, after, width, height);
  const assessment = assessIntegrity({
    ...pair,
    aspectRatioDifference: 0,
    resolutionRatio: 1
  });

  assert.equal(pair.changedRatio, 0);
  assert.equal(pair.edgeRetention, 1);
  assert.equal(assessment.risk, 'low');
  assert.equal(assessment.score, 100);
});

test('removing printed lines reduces edge retention', () => {
  const width = 100, height = 120;
  const before = blank(width, height);
  for (let y = 15; y <= 100; y += 17) drawLine(before, width, 10, y, 90, y);
  const after = blank(width, height);

  const pair = analyzeRgbaPair(before, after, width, height, { edgeThreshold: 45 });
  const assessment = assessIntegrity({
    ...pair,
    aspectRatioDifference: 0,
    resolutionRatio: 1
  });

  assert.ok(pair.edgeRetention < 0.5, `edge retention was ${pair.edgeRetention}`);
  assert.equal(assessment.risk, 'high');
  assert.ok(assessment.warnings.some(message => message.includes('邊緣')));
});

test('large page-wide changes produce warnings', () => {
  const width = 80, height = 100;
  const before = blank(width, height, 245);
  const after = blank(width, height, 150);

  const pair = analyzeRgbaPair(before, after, width, height);
  const assessment = assessIntegrity({
    ...pair,
    aspectRatioDifference: 0,
    resolutionRatio: 1
  });

  assert.ok(pair.changedRatio > 0.95);
  assert.ok(pair.hotspotRatio > 0.95);
  assert.notEqual(assessment.risk, 'low');
  assert.ok(assessment.warnings.some(message => message.includes('大範圍')));
});

test('geometry helper metrics are stable', () => {
  assert.equal(aspectRatioDifference(1000, 1400, 1000, 1400), 0);
  assert.ok(aspectRatioDifference(1000, 1400, 1000, 1200) > 0.1);
  assert.equal(resolutionRatio(1000, 1400, 500, 700), 0.25);
});
