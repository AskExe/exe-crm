import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import test from 'node:test';

const require = createRequire(import.meta.url);

test('BlockNote preserves rich text through HTML and Markdown conversion', async () => {
  const { ServerBlockNoteEditor } = await import('@blocknote/server-util');
  const editor = ServerBlockNoteEditor.create();
  const blocks = [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Release compatibility', styles: { bold: true } },
      ],
    },
  ];
  const html = await editor.blocksToHTMLLossy(blocks);
  assert.match(html, /<strong>Release compatibility<\/strong>/);
  const markdown = await editor.blocksToMarkdownLossy(blocks);
  assert.match(markdown, /\*\*Release compatibility\*\*/);
  const restored = await editor.tryParseHTMLToBlocks(html);
  assert.equal(restored[0].content[0].text, 'Release compatibility');
  assert.equal(restored[0].content[0].styles.bold, true);
});

test('XML signing verifies intact content and rejects a modified payload', () => {
  const { SignedXml } = require('xml-crypto');
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const signer = new SignedXml({
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
    canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#',
  });
  signer.addReference({
    xpath: "//*[local-name()='claim']",
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/2001/10/xml-exc-c14n#',
    ],
    digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
  });
  signer.computeSignature('<claim><subject>qa-fixture</subject></claim>');
  const signed = signer.getSignedXml();
  const verifier = new SignedXml({
    publicCert: publicKey.export({ type: 'spki', format: 'pem' }),
  });
  verifier.loadSignature(signer.getSignatureXml());
  assert.equal(verifier.checkSignature(signed), true);
  assert.equal(
    verifier.checkSignature(signed.replace('qa-fixture', 'changed')),
    false,
  );
});

test('YAML config nested values survive serialization', () => {
  const yaml = require('js-yaml');
  const config = { service: 'crm', enabled: true, allowed: ['read', 'write'] };
  assert.deepEqual(yaml.load(yaml.dump(config)), config);
});

test('Multer parses a multipart field and in-memory attachment', async () => {
  const multer = require('multer');
  const body = Buffer.from(
    '--qa-boundary\r\nContent-Disposition: form-data; name="description"\r\n\r\nRelease fixture\r\n--qa-boundary\r\nContent-Disposition: form-data; name="file"; filename="fixture.txt"\r\nContent-Type: text/plain\r\n\r\nattachment content\r\n--qa-boundary--\r\n',
  );
  const req = Readable.from([body]);
  req.headers = {
    'content-type': 'multipart/form-data; boundary=qa-boundary',
    'content-length': String(body.length),
  };
  await new Promise((resolve, reject) =>
    multer({ storage: multer.memoryStorage() }).single('file')(
      req,
      {},
      (error) => (error ? reject(error) : resolve()),
    ),
  );
  assert.equal(req.body.description, 'Release fixture');
  assert.equal(req.file.buffer.toString(), 'attachment content');
});

test('MailComposer builds Unicode headers and an attachment without sending', async () => {
  const MailComposer = require('nodemailer/lib/mail-composer');
  const message = await new MailComposer({
    from: 'QA <qa@example.invalid>',
    to: 'reader@example.invalid',
    subject: 'Résumé fixture',
    text: 'Release fixture',
    attachments: [{ filename: 'fixture.txt', content: 'attachment content' }],
  })
    .compile()
    .build();
  const mime = message.toString();
  assert.match(mime, /Subject: =\?UTF-8\?/i);
  assert.match(mime, /Content-Disposition: attachment; filename=fixture.txt/);
  assert.match(mime, /YXR0YWNobWVudCBjb250ZW50/);
});

test('Sharp loads its native library and resizes a generated image', async () => {
  const sharp = require('sharp');
  const source = await sharp({
    create: { width: 4, height: 4, channels: 3, background: '#336699' },
  })
    .png()
    .toBuffer();
  const result = await sharp(source)
    .resize(2, 2)
    .png()
    .toBuffer({ resolveWithObject: true });
  assert.equal(result.info.width, 2);
  assert.equal(result.info.height, 2);
  assert.equal(result.info.format, 'png');
});

// Exercise the v2 branch used by the SVG-to-React build transform.
test('SVGO removes executable namespaced SVG links', () => {
  const svgRequire = createRequire(
    require.resolve('babel-plugin-inline-react-svg'),
  );
  const { optimize } = svgRequire('svgo');
  const source =
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:s="http://www.w3.org/2000/svg"><s:a href="java&#9;script:alert(1)"><rect width="10" height="10"/></s:a></svg>';
  const { data } = optimize(source, { plugins: ['removeScriptElement'] });
  assert.doesNotMatch(data, /script:|alert\(1\)/);
  assert.match(data, /rect/);
});
