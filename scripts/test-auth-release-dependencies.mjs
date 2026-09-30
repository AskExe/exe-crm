import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);

test('mail transport preserves recipients, Unicode headers and attachments without sending', async () => {
  const { createTransport } = require('nodemailer');
  const transport = createTransport({ streamTransport: true, buffer: true });
  const result = await transport.sendMail({
    from: 'QA <qa@example.invalid>',
    to: 'Reader <reader@example.invalid>',
    subject: 'Résumé fixture',
    text: 'Release fixture',
    attachments: [{ filename: 'fixture.txt', content: 'attachment content' }],
  });
  assert.deepEqual(result.envelope.to, ['reader@example.invalid']);
  const mime = result.message.toString();
  assert.match(mime, /Subject: =\?UTF-8\?/i);
  assert.match(mime, /Content-Disposition: attachment; filename=fixture.txt/);
  assert.match(mime, /YXR0YWNobWVudCBjb250ZW50/);
});

test('HTTP fetch preserves a JSON response without making network requests', async () => {
  const { MockAgent, fetch } = require('undici');
  const dispatcher = new MockAgent();
  dispatcher.disableNetConnect();
  dispatcher
    .get('https://qa.example.invalid')
    .intercept({ path: '/session' })
    .reply(
      200,
      { authenticated: true },
      { headers: { 'content-type': 'application/json' } },
    );
  try {
    const response = await fetch('https://qa.example.invalid/session', {
      dispatcher,
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { authenticated: true });
  } finally {
    await dispatcher.close();
  }
});

test('glob matching preserves brace ranges and rejects values outside the range', () => {
  const module = require('minimatch');
  const match = typeof module === 'function' ? module : module.minimatch;
  assert.equal(match('file3.txt', 'file{1..4}.txt'), true);
  assert.equal(match('file5.txt', 'file{1..4}.txt'), false);
});

test('URI serialization preserves the trusted host and rejects injected authority', () => {
  const uri = require('fast-uri');
  assert.equal(
    uri.serialize({
      scheme: 'https',
      host: 'qa.example.invalid',
      port: 8443,
      path: '/app',
    }),
    'https://qa.example.invalid:8443/app',
  );
  assert.throws(() =>
    uri.serialize({
      scheme: 'https',
      host: 'qa.example.invalid',
      port: '@127.0.0.1:8124',
      path: '/app',
    }),
  );
});

test('ISO date validation accepts dates and rejects invalid input', () => {
  const joi = require('joi');
  const schema = joi.string().isoDate();
  assert.equal(schema.validate('2026-09-30T12:00:00.000Z').error, undefined);
  assert.ok(schema.validate('not a date').error);
});
