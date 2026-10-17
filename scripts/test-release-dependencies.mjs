import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(
  new URL('../packages/twenty-server/package.json', import.meta.url),
);

test('GraphQL consumers preserve variables, fragments and middleware after delegation', async () => {
  require('reflect-metadata');
  assert.equal(
    typeof serverRequire('@nestjs/graphql').GraphQLModule,
    'function',
  );
  const { makeExecutableSchema } = require('@graphql-tools/schema');
  const { wrapSchema } = require('@graphql-tools/wrap');
  const { applyMiddleware } = require('graphql-middleware');
  const { createYoga } = require('graphql-yoga');
  const { execute } = require('@graphql-tools/executor');
  const schema = makeExecutableSchema({
    typeDefs: 'type Query { greeting(name: String!): String! }',
    resolvers: { Query: { greeting: (_, { name }) => `Hello ${name}` } },
  });
  const delegatedSchema = wrapSchema({
    schema,
    executor: (request) =>
      execute({
        schema,
        document: request.document,
        variableValues: request.variables,
        contextValue: request.context,
      }),
  });
  let calls = 0;
  const yoga = createYoga({
    schema: applyMiddleware(
      delegatedSchema,
      async (resolve, root, args, context, info) => {
        calls++;
        return resolve(root, args, context, info);
      },
    ),
    logging: false,
  });
  for (const show of [true, false]) {
    const response = await yoga.fetch('http://localhost/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query:
          'query($name: String!, $show: Boolean!) { ...Fields } fragment Fields on Query { message: greeting(name: $name) @include(if: $show) }',
        variables: { name: 'CRM', show },
      }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      data: show ? { message: 'Hello CRM' } : {},
    });
  }
  assert.equal(calls, 1);
});

test('GraphQL deep merge rejects prototype pollution while retaining nested values', () => {
  const { mergeDeep } = require('@graphql-tools/utils');
  const merged = mergeDeep([
    { settings: { enabled: true } },
    JSON.parse(
      '{"settings":{"label":"CRM"},"constructor":{"prototype":{"releasePolluted":true}}}',
    ),
  ]);
  assert.deepEqual(merged.settings, { enabled: true, label: 'CRM' });
  assert.equal(Object.prototype.releasePolluted, undefined);
});

test('GraphQL code generation loads schema files and reports invalid documents', async () => {
  const { generate } = require('@graphql-codegen/cli');
  const directory = await mkdtemp(join(tmpdir(), 'crm-codegen-'));
  try {
    const schema = join(directory, 'schema.graphql');
    const documents = join(directory, 'query.graphql');
    await writeFile(schema, 'type Query { greeting(name: String!): String! }');
    await writeFile(
      documents,
      'query Greeting($name: String!) { greeting(name: $name) }',
    );
    const config = {
      schema,
      documents,
      generates: {
        [join(directory, 'types.ts')]: {
          plugins: ['typescript', 'typescript-operations'],
        },
      },
      silent: true,
    };
    const output = await generate(config, false);
    assert.match(output[0].content, /export type GreetingQuery/);
    await writeFile(documents, 'query Invalid { missingField }');
    await assert.rejects(
      generate(config, false),
      /Cannot query field "missingField"/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('Axios preserves JSON and request transforms through its adapter', async () => {
  const axios = require('axios');
  const response = await axios.post(
    'https://qa.example.invalid/records',
    { name: 'CRM' },
    {
      adapter: async (config) => {
        assert.equal(config.method, 'post');
        assert.equal(config.data, '{"name":"CRM"}');
        return {
          data: '{"id":"fixture"}',
          status: 201,
          statusText: 'Created',
          headers: {},
          config,
        };
      },
    },
  );
  assert.equal(response.status, 201);
  assert.deepEqual(response.data, { id: 'fixture' });
});

test('Handlebars escapes values and denies inherited template properties', () => {
  const handlebars = require('handlebars');
  const template = handlebars.compile('{{name}} {{inherited}}');
  const value = Object.assign(Object.create({ inherited: 'private' }), {
    name: '<CRM>',
  });
  assert.equal(template(value, { logger: { log() {} } }), '&lt;CRM&gt; ');
});

test('Proxy trust keeps the first untrusted address as the client', () => {
  const proxyaddr = require('proxy-addr');
  const request = {
    socket: { remoteAddress: '127.0.0.1' },
    headers: { 'x-forwarded-for': '198.51.100.1, 203.0.113.2' },
  };
  assert.equal(
    proxyaddr(request, proxyaddr.compile('loopback')),
    '203.0.113.2',
  );
});

test('PostCSS generates a consumable source map', async () => {
  const postcss = require('postcss');
  const { SourceMapConsumer } = require('source-map-js');
  const result = await postcss([]).process('a { color: red }', {
    from: 'input.css',
    to: 'output.css',
    map: { inline: false },
  });
  const consumer = new SourceMapConsumer(result.map.toJSON());
  assert.equal(
    consumer.originalPositionFor({ line: 1, column: 0 }).source,
    'input.css',
  );
});

test('gRPC can create and close a channel without connecting', () => {
  const { Channel, ChannelCredentials } = require('@grpc/grpc-js');
  const channel = new Channel(
    'localhost:1',
    ChannelCredentials.createInsecure(),
    {},
  );
  assert.equal(channel.getTarget(), 'dns:localhost:1');
  channel.close();
});

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

for (const [major, consumerRequire] of [
  [3, require],
  [4, createRequire(require.resolve('cosmiconfig'))],
]) {
  test(`YAML v${major} config nested values survive serialization`, () => {
    const yaml = consumerRequire('js-yaml');
    assert.equal(
      Number(consumerRequire('js-yaml/package.json').version.split('.')[0]),
      major,
    );
    const config = {
      service: 'crm',
      enabled: true,
      allowed: ['read', 'write'],
    };
    assert.deepEqual(yaml.load(yaml.dump(config)), config);
  });
}

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
